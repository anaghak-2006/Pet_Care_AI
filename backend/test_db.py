from sqlalchemy import text
from database import engine

try:
    with engine.connect() as connection:
        result = connection.execute(text("SELECT DATABASE()"))
        database_name = result.scalar()

        print("MySQL connection successful!")
        print("Connected database:", database_name)

except Exception as error:
    print("MySQL connection failed.")
    print("Error:", error)