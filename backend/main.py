
import os
import json
import re
import time
from datetime import datetime, timedelta, timezone
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from urllib.parse import quote

import jwt
from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session
from sqlalchemy import func, select

from database import SessionLocal
from models import User

from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.exc import IntegrityError

from security import hash_password, verify_password
class UserRegister(BaseModel):
    name: str
    email: EmailStr
    password: str


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class AssistantQuestion(BaseModel):
    question: str = Field(min_length=2, max_length=2000)


app = FastAPI(title="PetCareAI API")
bearer_scheme = HTTPBearer(auto_error=False)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in os.getenv("FRONTEND_ORIGINS", "*").split(",")],
    allow_credentials=False,
    allow_methods=["POST"],
    allow_headers=["Authorization", "Content-Type"],
)

SECRET_KEY = os.getenv("JWT_SECRET_KEY")

if not SECRET_KEY:
    raise RuntimeError("JWT_SECRET_KEY is missing from the .env file")

ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.8-flash")
GEMINI_FALLBACK_MODELS = [
    model.strip()
    for model in os.getenv("GEMINI_FALLBACK_MODELS", "gemini-flash-latest,gemini-3.7-flash").split(",")
    if model.strip() and model.strip() != GEMINI_MODEL
]

ASSISTANT_SYSTEM_PROMPT = (
    "You are PetCareAI, a helpful pet-care information assistant. "
    "Answer in exactly 4 complete, concise, useful sentences in one paragraph. "
    "Do not use a heading or bullet list. "
    "Do not diagnose, prescribe medication, or replace a veterinarian. "
    "For possible poisoning, breathing trouble, seizures, collapse, "
    "or severe symptoms, tell the user to contact an emergency veterinarian now. "
    "If details such as species or age are needed, state the assumption or ask briefly."
)


class AIProviderError(Exception):
    def __init__(self, message: str, status_code: int | None = None):
        super().__init__(message)
        self.status_code = status_code


def _has_expected_sentence_count(answer: str) -> bool:
    sentences = re.findall(r"[^.!?]+[.!?](?:[\"')\]]*)", answer.strip())
    return 4 <= len(sentences) <= 5


def _ensure_answer_length(question: str, answer: str, regenerate) -> str:
    if _has_expected_sentence_count(answer):
        return answer

    repair_prompt = (
        "Rewrite this draft to answer the original question using exactly 4 complete, "
        "concise sentences in one paragraph. Do not use a heading or bullets, and finish "
        "all 4 sentences. Original question: " + question + " Draft: " + answer
    )
    repaired = regenerate(repair_prompt)
    if not _has_expected_sentence_count(repaired):
        raise AIProviderError("returned an incomplete answer after retrying")
    return repaired


def _post_ai_json(url: str, payload: dict, headers: dict, timeout: int = 30) -> dict:
    request = Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={**headers, "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            result = json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        if error.code == 429:
            reason = "reached its usage limit"
        elif error.code in (401, 403):
            reason = "rejected its configured API key"
        else:
            reason = f"returned HTTP {error.code}"
        raise AIProviderError(reason, error.code) from error
    except TimeoutError as error:
        raise AIProviderError("timed out") from error
    except URLError as error:
        raise AIProviderError("could not be reached") from error
    except json.JSONDecodeError as error:
        raise AIProviderError("returned invalid data") from error

    if not isinstance(result, dict):
        raise AIProviderError("returned invalid data")
    return result


def _post_ai_stream(url: str, payload: dict, headers: dict, timeout: int = 60) -> str:
    request = Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={**headers, "Content-Type": "application/json"},
        method="POST",
    )
    text_parts = []
    try:
        with urlopen(request, timeout=timeout) as response:
            for raw_line in response:
                line = raw_line.decode("utf-8").strip()
                if not line.startswith("data:"):
                    continue

                data = line[5:].strip()
                if not data or data == "[DONE]":
                    continue

                event = json.loads(data)
                candidates = event.get("candidates") if isinstance(event, dict) else None
                if not isinstance(candidates, list) or not candidates or not isinstance(candidates[0], dict):
                    continue

                content = candidates[0].get("content")
                parts = content.get("parts") if isinstance(content, dict) else None
                if isinstance(parts, list):
                    text_parts.extend(
                        part["text"]
                        for part in parts
                        if isinstance(part, dict) and isinstance(part.get("text"), str)
                    )
    except HTTPError as error:
        if error.code == 429:
            reason = "reached its usage limit"
        elif error.code in (401, 403):
            reason = "rejected its configured API key"
        else:
            reason = f"returned HTTP {error.code}"
        raise AIProviderError(reason, error.code) from error
    except TimeoutError as error:
        raise AIProviderError("timed out") from error
    except URLError as error:
        raise AIProviderError("could not be reached") from error
    except json.JSONDecodeError as error:
        raise AIProviderError("returned invalid stream data") from error

    answer = "".join(text_parts).strip()
    if not answer:
        raise AIProviderError("returned no answer")
    return answer


def _ask_gemini(question: str) -> str:
    failures = []
    for model_name in [GEMINI_MODEL, *GEMINI_FALLBACK_MODELS]:
        model = quote(model_name, safe="")

        def generate(user_prompt: str) -> str:
            for attempt in range(2):
                try:
                    return _post_ai_stream(
                        f"https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent?alt=sse",
                        {
                            "systemInstruction": {"parts": [{"text": ASSISTANT_SYSTEM_PROMPT}]},
                            "contents": [{"role": "user", "parts": [{"text": user_prompt}]}],
                            "generationConfig": {"temperature": 0.4, "maxOutputTokens": 450},
                        },
                        {"x-goog-api-key": GEMINI_API_KEY},
                        timeout=60,
                    )
                except AIProviderError as error:
                    if error.status_code != 503 or attempt == 1:
                        raise
                    time.sleep(1)

            raise AIProviderError("could not complete the request")

        try:
            answer = generate(question)
            return _ensure_answer_length(question, answer, generate)
        except AIProviderError as error:
            failures.append(f"{model_name} {error}")

    raise AIProviderError("; ".join(failures))


def _ask_openai(question: str) -> str:
    def generate(user_prompt: str) -> str:
        result = _post_ai_json(
            "https://api.openai.com/v1/chat/completions",
            {
                "model": OPENAI_MODEL,
                "messages": [
                    {"role": "system", "content": ASSISTANT_SYSTEM_PROMPT},
                    {"role": "user", "content": user_prompt},
                ],
                "temperature": 0.4,
                "max_tokens": 450,
            },
            {"Authorization": f"Bearer {OPENAI_API_KEY}"},
        )
        choices = result.get("choices")
        if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
            raise AIProviderError("returned no answer")

        message = choices[0].get("message")
        content = message.get("content") if isinstance(message, dict) else None
        if not isinstance(content, str) or not content.strip():
            raise AIProviderError("returned no answer")
        return content.strip()

    answer = generate(question)
    return _ensure_answer_length(question, answer, generate)

def create_access_token(user_id: int, email: str, role: str):
    expire = datetime.now(timezone.utc) + timedelta(
        minutes=ACCESS_TOKEN_EXPIRE_MINUTES
    )

    payload = {
        "sub": str(user_id),
        "email": email,
        "role": role,
        "exp": expire
    }

    token = jwt.encode(
        payload,
        SECRET_KEY,
        algorithm=ALGORITHM
    )

    return token


def require_access_token(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
):
    if credentials is None:
        raise HTTPException(
            status_code=401,
            detail="Sign in to use the PetCareAI assistant",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        claims = jwt.decode(
            credentials.credentials,
            SECRET_KEY,
            algorithms=[ALGORITHM],
        )
    except jwt.InvalidTokenError:
        raise HTTPException(
            status_code=401,
            detail="Your session is invalid or has expired",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not claims.get("sub"):
        raise HTTPException(status_code=401, detail="Invalid access token")

    return claims

# Database session for each request
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@app.get("/")
def root():
    return {"message": "PetCareAI Backend is running"}


# Get all users
@app.get("/users")
def get_users(db: Session = Depends(get_db)):
    users = db.scalars(select(User)).all()

    return [
        {
            "id": user.id,
            "name": user.name,
            "email": user.email,
            "role": user.role,
            "created_at": user.created_at,
        }
        for user in users
    ]


# Get one user by ID
@app.get("/users/{user_id}")
def get_user(user_id: int, db: Session = Depends(get_db)):
    user = db.get(User, user_id)

    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    return {
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "role": user.role,
        "created_at": user.created_at,
    }


@app.post("/register", status_code=201)
def register_user(
    user_data: UserRegister,
    db: Session = Depends(get_db)
):
    if len(user_data.password) < 8:
        raise HTTPException(
            status_code=400,
            detail="Password must be at least 8 characters long"
        )

    email = str(user_data.email).strip().lower()
    existing_user = db.query(User).filter(
        func.lower(User.email) == email
    ).first()

    if existing_user:
        raise HTTPException(
            status_code=409,
            detail="Email is already registered"
        )

    new_user = User(
        name=user_data.name,
        email=email,
        password_hash=hash_password(user_data.password),
        role="pet_owner"
    )

    try:
        db.add(new_user)
        db.commit()
        db.refresh(new_user)

        return {
            "message": "Registration successful",
            "user": {
                "id": new_user.id,
                "name": new_user.name,
                "email": new_user.email,
                "role": new_user.role
            }
        }

    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Email is already registered"
        )



@app.post("/login")
def login_user(
    user_data: UserLogin,
    db: Session = Depends(get_db)
):
    email = str(user_data.email).strip().lower()
    user = db.query(User).filter(
        func.lower(User.email) == email
    ).first()

    if not user or not verify_password(
        user_data.password,
        user.password_hash
    ):
        raise HTTPException(
            status_code=401,
            detail="Invalid email or password"
        )

    access_token = create_access_token(
        user_id=user.id,
        email=user.email,
        role=user.role
    )

    return {
        "message": "Login successful",
        "access_token": access_token,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "name": user.name,
            "email": user.email,
            "role": user.role
        }
    }


@app.post("/assistant/ask", dependencies=[Depends(require_access_token)])
def ask_assistant(request_data: AssistantQuestion):
    providers = []
    if GEMINI_API_KEY:
        providers.append(("Gemini", _ask_gemini))
    if OPENAI_API_KEY:
        providers.append(("OpenAI", _ask_openai))

    if not providers:
        raise HTTPException(
            status_code=503,
            detail="AI is not configured. Add GEMINI_API_KEY or OPENAI_API_KEY to backend/.env and restart the backend.",
        )

    question = request_data.question.strip()
    if not question:
        raise HTTPException(status_code=422, detail="Enter a question")

    failures = []
    for provider_name, generate_answer in providers:
        try:
            return {"answer": generate_answer(question)}
        except AIProviderError as error:
            failures.append(f"{provider_name} {error}")

    detail = "All configured AI providers failed: " + "; ".join(failures)
    raise HTTPException(status_code=503, detail=detail)

