from pydantic_settings import BaseSettings
from pydantic import Field
from functools import lru_cache
from pathlib import Path

# .env lives at the project root (one level above backend/)
_ENV_FILE = Path(__file__).resolve().parent.parent.parent / ".env"


class Settings(BaseSettings):
    # Database
    db_driver: str = Field(default="mysql+mysqlconnector")
    db_user: str
    db_password: str
    db_host: str
    db_port: int = Field(default=3306)
    db_name: str

    # Redis
    redis_host: str = Field(default="localhost")
    redis_port: int = Field(default=6379)
    redis_password: str = Field(default="")

    # Application
    app_env: str = Field(default="development")
    secret_key: str = Field(default="change-this-secret")
    allowed_origins: str = Field(default="http://localhost:3000")

    # AI (Phase 5)
    anthropic_api_key: str = Field(default="")

    class Config:
        env_file = str(_ENV_FILE)
        env_file_encoding = "utf-8"
        case_sensitive = False
        extra = "ignore"        # silently skip FRONTEND_PORT, BACKEND_PORT, etc.

    @property
    def database_url(self) -> str:
        # Using URL.create avoids issues with special chars (@ # %) in password
        from sqlalchemy.engine import URL
        return URL.create(
            drivername=self.db_driver,
            username=self.db_user,
            password=self.db_password,
            host=self.db_host,
            port=self.db_port,
            database=self.db_name,
        )

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",")]


@lru_cache()
def get_settings() -> Settings:
    return Settings()
