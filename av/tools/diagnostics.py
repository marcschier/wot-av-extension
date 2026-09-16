"""Stable AV diagnostics; ValueError compatibility is retained for existing callers."""

from __future__ import annotations

from functools import wraps


CODES = frozenset("""
AV_INVALID_SYNTAX AV_INVALID_DESCRIPTION AV_INVALID_CONTRACT AV_UNSUPPORTED_CONTRACT
AV_EXTERNAL_REFERENCE AV_UNRESOLVED_REFERENCE AV_AMBIGUOUS_FORM
AV_UNSUPPORTED_NATIVE_ACCESS AV_MISSING_NATIVE_PARAMETER AV_INVALID_NATIVE_PARAMETER
AV_UNKNOWN_PAYLOAD_SCHEMA AV_NATIVE_FAILURE AV_RESOURCE_LIMIT AV_EDITION_INCONSISTENT
""".split())


class AVError(ValueError):
    def __init__(self, code, message, *, stage, location="", reason=None,
                 instance_location=None, native_status=None, execution="not-attempted",
                 limit=None, measured=None):
        if code not in CODES:
            raise ValueError("Unknown diagnostic code: " + code)
        super().__init__(message)
        self.code = code
        self.stage = stage
        self.location = location
        self.reason = reason
        self.instance_location = instance_location
        self.native_status = native_status
        self.execution = execution
        self.limit = limit
        self.measured = measured

    def as_dict(self):
        return {key: value for key, value in {
            "code": self.code, "stage": self.stage, "message": str(self),
            "location": self.location, "reason": self.reason,
            "instanceLocation": self.instance_location, "nativeStatus": self.native_status,
            "execution": self.execution, "limit": self.limit, "measured": self.measured,
        }.items() if value is not None}


def diagnostic(code, stage):
    """Translate legacy validation errors without hiding already classified failures."""
    def decorate(function):
        @wraps(function)
        def checked(*args, **kwargs):
            try:
                return function(*args, **kwargs)
            except AVError:
                raise
            except ValueError as error:
                raise AVError(code, str(error), stage=stage) from error
            except RecursionError as error:
                raise AVError("AV_RESOURCE_LIMIT", "Nesting exceeds the processing budget",
                              stage=stage, limit="nesting") from error
        return checked
    return decorate
