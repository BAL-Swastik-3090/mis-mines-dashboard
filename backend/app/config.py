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

    # MineHub platform database (PostgreSQL).
    # The MySQL above stays a read-only SOURCE; everything the platform owns
    # lives here. Optional so the dashboard still starts if it is not configured.
    pg_host:     str = Field(default="")
    pg_port:     int = Field(default=5432)
    pg_database: str = Field(default="")
    pg_user:     str = Field(default="")
    pg_password: str = Field(default="")
    pg_schema:   str = Field(default="minehub")
    # How much encryption to insist on. libpq's own default is "prefer", which
    # uses TLS when the server offers it and plaintext when it does not — so a
    # server that quietly stops offering TLS is never noticed. Set "require"
    # once the server actually has ssl = on, and a silent downgrade becomes a
    # refused connection instead.
    pg_sslmode:  str = Field(default="prefer")

    # Where to try if the first address does not answer.
    #
    # This machine reaches the platform database two different ways depending on
    # which network it is on, and neither works from the other. On the office
    # wifi the server is directly reachable on the LAN. Over the VPN it is not:
    # the server sees us as a foreign address, pg_hba there insists on an
    # encrypted connection, and the server offers no TLS — so the VPN route runs
    # through an SSH tunnel on localhost instead.
    #
    # Rather than making somebody edit .env every time they undock, both
    # addresses are configured and whichever answers is used. A developer
    # changing network should not have to know any of the above.
    pg_fallback_host: str = Field(default="")
    pg_fallback_port: int = Field(default=5432)

    # Face-recognition attendance (SmartFace, MSSQL). A read-only source, like
    # the MySQL above: the mine's attendance system owns these punches and this
    # platform only reads them. Blank host means the integration is off, and the
    # screens say so rather than failing.
    frs_host:     str = Field(default="")
    frs_port:     int = Field(default=1433)
    frs_database: str = Field(default="SmartFace")
    frs_user:     str = Field(default="")
    frs_password: str = Field(default="")

    # LiteLLM / AI Insights
    litellm_base_url: str = Field(default="")
    litellm_api_key:  str = Field(default="")
    litellm_model:    str = Field(default="claude-sonnet-4-6")

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
    def minehub_enabled(self) -> bool:
        return bool(self.pg_host and self.pg_database and self.pg_user)

    def minehub_url_for(self, host: str, port: int):
        from sqlalchemy.engine import URL
        return URL.create(
            drivername="postgresql+psycopg",
            username=self.pg_user,
            password=self.pg_password,
            host=host,
            port=port,
            database=self.pg_database,
            query={"sslmode": self.pg_sslmode},
        )

    @property
    def minehub_url(self):
        return self.minehub_url_for(self.pg_host, self.pg_port)

    @property
    def minehub_fallback_url(self):
        """The second address to try, or None when only one is configured."""
        if not self.pg_fallback_host:
            return None
        if (self.pg_fallback_host, self.pg_fallback_port) == (self.pg_host, self.pg_port):
            return None
        return self.minehub_url_for(self.pg_fallback_host, self.pg_fallback_port)

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",")]


@lru_cache()
def get_settings() -> Settings:
    return Settings()
