"""Tests for auth module — partial coverage."""
import pytest
from src.auth import PasswordPolicy, UserStore, validate_email


class TestPasswordPolicy:
    def setup_method(self):
        self.policy = PasswordPolicy()

    def test_valid_password(self):
        valid, errors = self.policy.validate("Secure1!")
        assert valid is True
        assert errors == []

    def test_too_short(self):
        valid, errors = self.policy.validate("Ab1!")
        assert valid is False
        assert any("8 characters" in e for e in errors)

    def test_no_uppercase(self):
        valid, errors = self.policy.validate("secure1!")
        assert valid is False
        assert any("uppercase" in e for e in errors)

    # MISSING: test_no_digit
    # MISSING: test_no_special_character
    # MISSING: test_multiple_violations_reported_together
    # MISSING: test_empty_password


class TestUserStore:
    def setup_method(self):
        self.store = UserStore()

    def test_register_and_authenticate(self):
        self.store.register("alice", "Secure1!")
        assert self.store.authenticate("alice", "Secure1!") is True

    def test_wrong_password_fails(self):
        self.store.register("bob", "Secure1!")
        assert self.store.authenticate("bob", "WrongPass1!") is False

    def test_duplicate_registration_raises(self):
        self.store.register("carol", "Secure1!")
        with pytest.raises(ValueError, match="already exists"):
            self.store.register("carol", "Secure1!")

    # MISSING: test_register_with_weak_password_raises
    # MISSING: test_register_empty_username_or_password_raises
    # MISSING: test_deactivate_user
    # MISSING: test_authenticate_deactivated_user_fails
    # MISSING: test_lockout_after_five_failed_attempts  ← critical security feature
    # MISSING: test_lockout_expires_after_five_minutes
    # MISSING: test_authenticate_unknown_user_returns_false


class TestValidateEmail:
    def test_valid_email(self):
        assert validate_email("user@example.com") is True

    def test_missing_at_symbol(self):
        assert validate_email("userexample.com") is False

    # MISSING: test_missing_domain
    # MISSING: test_subdomain_email
    # MISSING: test_email_with_plus_addressing
    # MISSING: test_empty_string
    # MISSING: test_consecutive_dots

# ENTIRELY MISSING TEST CLASSES:
# - TestGenerateToken   ← token creation not tested at all
# - TestVerifyToken     ← token verification not tested at all
#   (includes: expired token, tampered signature, malformed token, valid token)
