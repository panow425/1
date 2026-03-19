"""Authentication and authorization module."""
import hashlib
import hmac
import re
import time
from typing import Optional


class PasswordPolicy:
    """Enforces password strength requirements."""

    MIN_LENGTH = 8
    REQUIRE_UPPERCASE = True
    REQUIRE_DIGIT = True
    REQUIRE_SPECIAL = True
    SPECIAL_CHARS = "!@#$%^&*()_+-=[]{}|;:,.<>?"

    def validate(self, password: str) -> tuple[bool, list[str]]:
        errors = []
        if len(password) < self.MIN_LENGTH:
            errors.append(f"Password must be at least {self.MIN_LENGTH} characters.")
        if self.REQUIRE_UPPERCASE and not any(c.isupper() for c in password):
            errors.append("Password must contain at least one uppercase letter.")
        if self.REQUIRE_DIGIT and not any(c.isdigit() for c in password):
            errors.append("Password must contain at least one digit.")
        if self.REQUIRE_SPECIAL and not any(c in self.SPECIAL_CHARS for c in password):
            errors.append("Password must contain at least one special character.")
        return len(errors) == 0, errors


class UserStore:
    """In-memory user storage for demo purposes."""

    def __init__(self):
        self._users: dict[str, dict] = {}
        self._failed_attempts: dict[str, list[float]] = {}

    def register(self, username: str, password: str) -> bool:
        if not username or not password:
            raise ValueError("Username and password are required.")
        if username in self._users:
            raise ValueError(f"User '{username}' already exists.")
        policy = PasswordPolicy()
        valid, errors = policy.validate(password)
        if not valid:
            raise ValueError("; ".join(errors))
        hashed = self._hash_password(password)
        self._users[username] = {"password": hashed, "active": True, "created_at": time.time()}
        return True

    def authenticate(self, username: str, password: str) -> bool:
        if self._is_locked_out(username):
            raise PermissionError(f"Account '{username}' is temporarily locked.")
        user = self._users.get(username)
        if not user or not user["active"]:
            self._record_failed_attempt(username)
            return False
        if not hmac.compare_digest(self._hash_password(password), user["password"]):
            self._record_failed_attempt(username)
            return False
        self._failed_attempts.pop(username, None)
        return True

    def deactivate(self, username: str) -> bool:
        if username not in self._users:
            raise KeyError(f"User '{username}' not found.")
        self._users[username]["active"] = False
        return True

    def _hash_password(self, password: str) -> str:
        return hashlib.sha256(password.encode()).hexdigest()

    def _is_locked_out(self, username: str) -> bool:
        attempts = self._failed_attempts.get(username, [])
        cutoff = time.time() - 300  # 5-minute window
        recent = [t for t in attempts if t > cutoff]
        return len(recent) >= 5

    def _record_failed_attempt(self, username: str):
        if username not in self._failed_attempts:
            self._failed_attempts[username] = []
        self._failed_attempts[username].append(time.time())


def validate_email(email: str) -> bool:
    """Validate email format."""
    pattern = r"^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$"
    return bool(re.match(pattern, email))


def generate_token(user_id: str, secret: str, expires_in: int = 3600) -> str:
    """Generate a simple HMAC-based auth token."""
    expiry = int(time.time()) + expires_in
    payload = f"{user_id}:{expiry}"
    sig = hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return f"{payload}:{sig}"


def verify_token(token: str, secret: str) -> Optional[str]:
    """Verify a token and return user_id if valid, else None."""
    try:
        parts = token.split(":")
        if len(parts) != 3:
            return None
        user_id, expiry_str, sig = parts
        if int(expiry_str) < time.time():
            return None
        payload = f"{user_id}:{expiry_str}"
        expected = hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expected):
            return None
        return user_id
    except (ValueError, AttributeError):
        return None
