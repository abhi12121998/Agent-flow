"""
Document Validator
──────────────────
Reads a document line by line and validates:
  - Encoding (UTF-8 safe)
  - Empty / whitespace-only lines
  - Line length limits
  - Forbidden patterns (PII hints, SQL injection, script tags, etc.)
  - Structural rules for known formats (.md, .csv, .json, .env, .txt)
  - JSON validity for .json files
  - CSV header consistency

Returns a structured ValidationReport with per-line results.
"""
from __future__ import annotations

import re
import json
import os
from dataclasses import dataclass, field
from typing import List, Optional, Tuple


# ── Config ─────────────────────────────────────────────────────────────────────
MAX_LINE_LENGTH = 2000

FORBIDDEN_PATTERNS = [
    (re.compile(r"<script[\s>]", re.IGNORECASE),          "Potential XSS: <script> tag"),
    (re.compile(r"(DROP|DELETE|TRUNCATE)\s+TABLE", re.IGNORECASE), "Potential SQL injection"),
    (re.compile(r"(eval|exec)\s*\("),                      "Dangerous function call (eval/exec)"),
    (re.compile(r"\b\d{3}-\d{2}-\d{4}\b"),                "Possible SSN detected"),
    (re.compile(r"\b4[0-9]{12}(?:[0-9]{3})?\b"),          "Possible credit card number"),
    (re.compile(r"password\s*=\s*\S+", re.IGNORECASE),    "Hardcoded password pattern"),
    (re.compile(r"(api_key|apikey|secret)\s*=\s*\S+", re.IGNORECASE), "Hardcoded API key pattern"),
]


# ── Data classes ───────────────────────────────────────────────────────────────
@dataclass
class LineResult:
    line_number: int
    content: str
    is_valid: bool
    warnings: List[str] = field(default_factory=list)
    errors: List[str] = field(default_factory=list)

    def to_dict(self):
        return {
            "line_number": self.line_number,
            "content": self.content[:120] + ("…" if len(self.content) > 120 else ""),
            "is_valid": self.is_valid,
            "warnings": self.warnings,
            "errors": self.errors,
        }


@dataclass
class ValidationReport:
    filename: str
    file_type: str
    total_lines: int
    valid_lines: int
    warning_lines: int
    error_lines: int
    is_valid: bool
    summary: str
    line_results: List[LineResult] = field(default_factory=list)
    global_errors: List[str] = field(default_factory=list)
    global_warnings: List[str] = field(default_factory=list)

    def to_dict(self):
        return {
            "filename": self.filename,
            "file_type": self.file_type,
            "total_lines": self.total_lines,
            "valid_lines": self.valid_lines,
            "warning_lines": self.warning_lines,
            "error_lines": self.error_lines,
            "is_valid": self.is_valid,
            "summary": self.summary,
            "global_errors": self.global_errors,
            "global_warnings": self.global_warnings,
            "line_results": [r.to_dict() for r in self.line_results if r.errors or r.warnings],
        }


# ── Core validator ─────────────────────────────────────────────────────────────
class DocumentValidator:

    def validate_bytes(self, filename: str, content_bytes: bytes) -> ValidationReport:
        """Validate document from raw bytes (e.g. uploaded file)."""
        # Attempt UTF-8 decode
        try:
            text = content_bytes.decode("utf-8")
        except UnicodeDecodeError:
            try:
                text = content_bytes.decode("latin-1")
                global_warnings = ["File is not UTF-8 encoded — decoded as latin-1"]
            except Exception:
                return ValidationReport(
                    filename=filename, file_type="unknown",
                    total_lines=0, valid_lines=0, warning_lines=0, error_lines=1,
                    is_valid=False, summary="Cannot decode file — not valid UTF-8 or latin-1",
                    global_errors=["Undecodable file encoding"],
                )
        else:
            global_warnings = []

        return self.validate_text(filename, text, global_warnings)

    def validate_text(
        self, filename: str, text: str, pre_warnings: List[str] = None
    ) -> ValidationReport:
        """Validate document from string content."""
        ext = os.path.splitext(filename)[1].lower() if filename else ".txt"
        lines = text.splitlines()
        if not lines and text:
            lines = [text]

        line_results: List[LineResult] = []
        global_errors: List[str] = list(pre_warnings or [])
        global_warnings: List[str] = []

        # ── Per-line validation ────────────────────────────────────────────────
        csv_header_count: Optional[int] = None

        for i, raw_line in enumerate(lines, start=1):
            result = self._validate_line(raw_line, i, ext)

            # CSV column count consistency
            if ext == ".csv":
                col_count = len(raw_line.split(","))
                if i == 1:
                    csv_header_count = col_count
                elif csv_header_count is not None and col_count != csv_header_count:
                    result.errors.append(
                        f"CSV column count mismatch: expected {csv_header_count}, got {col_count}"
                    )
                    result.is_valid = False

            line_results.append(result)

        # ── Global / whole-file checks ─────────────────────────────────────────
        if ext == ".json":
            try:
                json.loads(text)
            except json.JSONDecodeError as e:
                global_errors.append(f"Invalid JSON: {e}")

        if ext == ".env":
            for r in line_results:
                stripped = r.content.strip()
                if stripped and not stripped.startswith("#") and "=" not in stripped:
                    r.errors.append(".env line must be KEY=VALUE or a comment")
                    r.is_valid = False

        if ext == ".md":
            heading_lines = [r for r in line_results if r.content.startswith("#")]
            if not heading_lines:
                global_warnings.append("Markdown document has no headings (# H1)")

        # Check for duplicate lines (warn only)
        seen: dict = {}
        for r in line_results:
            stripped = r.content.strip()
            if not stripped:
                continue
            if stripped in seen:
                r.warnings.append(f"Duplicate of line {seen[stripped]}")
            else:
                seen[stripped] = r.line_number

        # ── Tally ─────────────────────────────────────────────────────────────
        error_lines   = sum(1 for r in line_results if r.errors)
        warning_lines = sum(1 for r in line_results if r.warnings and not r.errors)
        valid_lines   = len(line_results) - error_lines
        is_valid      = error_lines == 0 and not global_errors

        summary = (
            f"✓ Valid — {len(line_results)} lines, {warning_lines} warning(s)" if is_valid
            else f"✗ Invalid — {error_lines} error(s) across {len(line_results)} lines"
        )

        return ValidationReport(
            filename=filename,
            file_type=ext or "unknown",
            total_lines=len(line_results),
            valid_lines=valid_lines,
            warning_lines=warning_lines,
            error_lines=error_lines,
            is_valid=is_valid,
            summary=summary,
            line_results=line_results,
            global_errors=global_errors,
            global_warnings=global_warnings,
        )

    def _validate_line(self, raw: str, number: int, ext: str) -> LineResult:
        errors: List[str] = []
        warnings: List[str] = []

        # 1. Line length
        if len(raw) > MAX_LINE_LENGTH:
            errors.append(f"Line too long ({len(raw)} chars, max {MAX_LINE_LENGTH})")

        # 2. Null bytes
        if "\x00" in raw:
            errors.append("Null byte (\\x00) found — binary content in text file")

        # 3. Trailing whitespace (warn)
        if raw != raw.rstrip():
            warnings.append("Trailing whitespace")

        # 4. Tab characters in non-code files
        if ext not in (".py", ".js", ".jsx", ".ts", ".tsx", ".go") and "\t" in raw:
            warnings.append("Tab character — consider using spaces")

        # 5. Forbidden patterns (security / PII)
        for pattern, message in FORBIDDEN_PATTERNS:
            if pattern.search(raw):
                errors.append(message)

        # 6. Format-specific checks
        stripped = raw.strip()

        if ext == ".md":
            # Heading must have a space after #
            if re.match(r"^#{1,6}[^# \n]", raw):
                errors.append("Markdown heading missing space after # (e.g. use '# Title' not '#Title')")

        if ext == ".csv":
            # Unclosed quotes
            if raw.count('"') % 2 != 0:
                errors.append("Unclosed double-quote in CSV field")

        if ext in (".py",):
            # Common beginner mistakes
            if re.match(r"^\s*print\s+[\"']", raw):
                warnings.append("Python 2 print statement — use print() function")
            if "except:" in raw and "except Exception" not in raw:
                warnings.append("Bare 'except:' clause — consider 'except Exception as e'")

        # 7. Empty line (info only, not an error)
        if not stripped:
            pass  # empty lines are fine

        is_valid = len(errors) == 0
        return LineResult(
            line_number=number,
            content=raw,
            is_valid=is_valid,
            warnings=warnings,
            errors=errors,
        )


# ── Singleton ──────────────────────────────────────────────────────────────────
validator = DocumentValidator()
