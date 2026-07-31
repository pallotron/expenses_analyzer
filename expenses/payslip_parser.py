"""Pure parsing of Irish PAYE payslip text into structured records.

PDF I/O lives in extract functions further down; the ``parse_lines`` logic is
kept pure (operates on text) so it is unit-testable without PDF fixtures.
"""
import logging
import os
import re
from dataclasses import dataclass
from typing import List, Optional

logger = logging.getLogger(__name__)

_AMOUNT = re.compile(r"-?\d[\d,]*\.\d{2}")


def extract_amounts(text: str) -> List[float]:
    """Return all 2-decimal numbers in ``text`` (commas stripped)."""
    return [float(m.replace(",", "")) for m in _AMOUNT.findall(text)]


@dataclass
class PayslipRun:
    """One payroll run (one PDF). Gross/net are derived, not parsed."""

    month: str
    source_file: str
    salary: float = 0.0
    bonus: float = 0.0
    oncall: float = 0.0
    reimbursements: float = 0.0
    non_taxable_adj: float = 0.0
    misc_deductions: float = 0.0
    pension_ee: float = 0.0
    avc: float = 0.0
    pension_er: float = 0.0
    paye: float = 0.0
    prsi_ee: float = 0.0
    usc: float = 0.0
    pension_ee_ytd: float = 0.0
    avc_ytd: float = 0.0
    pension_er_ytd: float = 0.0
    stated_net: Optional[float] = None

    @property
    def gross(self) -> float:
        """Cash earnings (excludes notional BIK and non-taxable adjustments)."""
        return round(self.salary + self.bonus + self.oncall + self.reimbursements, 2)

    @property
    def tax_total(self) -> float:
        return round(self.paye + self.prsi_ee + self.usc, 2)

    @property
    def deds_from_gross(self) -> float:
        return round(self.pension_ee + self.avc, 2)

    @property
    def net(self) -> float:
        """Take-home pay, mirroring the payslip's own NETT PAY arithmetic."""
        return round(
            self.gross
            - self.deds_from_gross
            - self.tax_total
            - self.misc_deductions
            + self.non_taxable_adj,
            2,
        )

    @property
    def net_reconciled(self) -> bool:
        """True if the derived net matches the net the payslip itself states.

        An earnings or deduction label this parser does not know is otherwise
        invisible: it silently understates gross and net rather than failing.
        Comparing against the payslip's own figure turns that into a flag.
        True when the payslip states no net, since there is nothing to check.
        """
        if self.stated_net is None:
            return True
        return abs(self.net - self.stated_net) < 0.01


def _handle_salary(run: PayslipRun, nums: List[float]) -> bool:
    """Handle Salary line. Returns True if matched."""
    if nums:
        run.salary = nums[0]
        return True
    return False


def _handle_salary_adjustment(run: PayslipRun, nums: List[float]) -> bool:
    """Handle an adjustment to salary itself, rather than a separate award.

    Covers both directions: back pay adds salary earned earlier, unpaid leave
    subtracts salary not earned, and the payslip signs the amount accordingly.
    """
    if nums:
        run.salary += nums[0]
    return False


def _handle_bonus(run: PayslipRun, nums: List[float]) -> bool:
    """Handle Bonus line."""
    if nums:
        run.bonus += nums[0]
    return False


def _handle_oncall(run: PayslipRun, nums: List[float]) -> bool:
    """Handle On-Call line."""
    if nums:
        run.oncall = nums[0]
    return False


def _handle_device_reimbursement(run: PayslipRun, nums: List[float]) -> bool:
    """Handle a taxable reimbursement or subsidy, which counts toward gross."""
    if nums:
        run.reimbursements += nums[0]
    return False


def _handle_non_taxable(run: PayslipRun, nums: List[float]) -> bool:
    """Handle a non-taxable adjustment, added after tax rather than to gross."""
    if nums:
        run.non_taxable_adj += nums[0]
    return False


def _handle_notional(run: PayslipRun, nums: List[float]) -> bool:
    """Handle notional pay / BIK, which is taxed but never paid in cash.

    Matched explicitly so it is visibly excluded rather than silently ignored.
    """
    return False


def _handle_avc(run: PayslipRun, nums: List[float]) -> bool:
    """Handle AVC line."""
    if len(nums) >= 2:
        run.avc, run.avc_ytd = nums[0], nums[1]
    return False


def _handle_pension(run: PayslipRun, nums: List[float]) -> bool:
    """Handle Pension line. Returns True if matched."""
    if len(nums) >= 4:
        run.pension_ee, run.pension_ee_ytd = nums[0], nums[1]
        run.pension_er, run.pension_er_ytd = nums[2], nums[3]
        return True
    return False


def _handle_paye(run: PayslipRun, nums: List[float]) -> bool:
    """Handle PAYE line."""
    if nums:
        run.paye = nums[0]
    return False


def _handle_prsi(run: PayslipRun, nums: List[float]) -> bool:
    """Handle PRSI line."""
    if nums:
        run.prsi_ee = nums[0]
    return False


def _handle_usc(run: PayslipRun, nums: List[float]) -> bool:
    """Handle USC line. Uses 2nd amount (period amount, not base)."""
    if len(nums) >= 2:
        run.usc = nums[1]
    return False


# Labels are matched case-insensitively and on word boundaries, so payroll
# providers that differ only in vocabulary and casing share this one parser.
# A label may appear anywhere on a line, not just at the start: some providers
# run two items together on a single extracted line.
_HANDLERS = {
    "salary": _handle_salary,
    "backpay": _handle_salary_adjustment,
    "retro pay": _handle_salary_adjustment,
    "unpaid leave": _handle_salary_adjustment,
    "bonus": _handle_bonus,
    "sign on bonus": _handle_bonus,
    "bonus - prior year": _handle_bonus,
    "on-call": _handle_oncall,
    "device reimbursement": _handle_device_reimbursement,
    "device reimbur grossup": _handle_device_reimbursement,
    "health insurance sub": _handle_device_reimbursement,
    "device reimb(tax free)": _handle_non_taxable,
    "working from home sub": _handle_non_taxable,
    "subsistence vouched": _handle_non_taxable,
    "travel vouched": _handle_non_taxable,
    "small ben exemption": _handle_notional,
    "avc": _handle_avc,
    "pension": _handle_pension,
    "pension er": _handle_pension,
    "paye": _handle_paye,
    "prsi": _handle_prsi,
    "usc": _handle_usc,
}

# Longest first so that at a shared start position the more specific label wins
# ("Pension ER" over "Pension"). Trailing \b is omitted because some labels end
# in a bracket, where a word boundary would not hold.
_LABEL_RE = re.compile(
    r"\b(?:" + "|".join(re.escape(k) for k in sorted(_HANDLERS, key=len, reverse=True)) + r")",
    re.IGNORECASE,
)

_WS = re.compile(r"\s+")


_TAX_KEYS = ("paye", "prsi", "usc")


def _dispatch_line(run: PayslipRun, line: str) -> tuple:
    """Apply every label found on ``line``. Returns (saw_pension, saw_tax).

    Each label owns the text up to the next label, so a line carrying two items
    assigns each its own amounts rather than the first swallowing both.
    """
    matches = list(_LABEL_RE.finditer(line))
    if not matches:
        _record_misc_deduction(run, line)
        return False, False

    saw_pension = saw_tax = False
    for i, match in enumerate(matches):
        end = matches[i + 1].start() if i + 1 < len(matches) else len(line)
        nums = extract_amounts(line[match.end():end])
        key = _WS.sub(" ", match.group(0).strip().lower())
        if _HANDLERS[key](run, nums) and key.startswith("pension"):
            saw_pension = True
        if nums and key in _TAX_KEYS:
            saw_tax = True
    return saw_pension, saw_tax


def _record_misc_deduction(run: PayslipRun, line: str) -> None:
    """Treat an unrecognized labelled line carrying 4 amounts as a misc deduction.

    Deductions such as a social club or health insurance premium are keyed by
    provider-specific names that cannot be enumerated, but they share a fixed
    shape with the statutory lines: period, period-YTD, employer, employer-YTD.
    Matching on that shape keeps net accurate without hardcoding vendor names.
    """
    nums = extract_amounts(line)
    if len(nums) != 4:
        return
    label = _AMOUNT.sub("", line).strip()
    if not any(char.isalpha() for char in label):
        return
    run.misc_deductions = round(run.misc_deductions + nums[0], 2)


def _find_stated_net(lines: List[str]) -> Optional[float]:
    """Return the NETT PAY the payslip states, or None if it cannot be located.

    This layout emits its summary as a block of bare amounts followed by the
    matching block of labels, so the figures cannot be read by their label.
    What holds is the ordering: the summary is the last thing before the label
    block, and net is its final entry.
    """
    for index, line in enumerate(lines):
        if line.strip().upper() != "NOTE":
            continue
        amounts = extract_amounts("\n".join(lines[:index]))
        return amounts[-1] if amounts else None
    return None


def parse_lines(lines: List[str], month: str, source_file: str) -> Optional[PayslipRun]:
    """Parse stripped payslip text lines into a PayslipRun.

    Returns None if the Irish-format signature is absent (a Pension line
    carrying >= 4 amounts, plus at least one statutory tax line). This is the
    "fail loudly" guard: an unrecognized layout is never guessed at.

    Salary is deliberately not part of the signature. A month can have a
    supplementary run -- an off-cycle bonus or on-call payment -- which carries
    no salary line but must still be aggregated into that month's totals.
    """
    run = PayslipRun(month=month, source_file=source_file)
    run.stated_net = _find_stated_net(lines)
    saw_pension = False
    saw_tax = False

    for raw in lines:
        line_pension, line_tax = _dispatch_line(run, raw.strip())
        saw_pension = saw_pension or line_pension
        saw_tax = saw_tax or line_tax

    if not (saw_pension and saw_tax):
        logger.warning("Unrecognized payslip format for %s; skipping", source_file)
        return None
    return run


# Constrained to a real year and month so that an unrelated digit run in a
# filename cannot be mistaken for a date.
_MONTH_RE = re.compile(r"((?:19|20)\d{2}-(?:0[1-9]|1[0-2]))")


class PayslipDecryptError(Exception):
    """Raised when an encrypted payslip cannot be opened with the given password."""


def month_from_filename(name: str) -> Optional[str]:
    """Extract a YYYY-MM from anywhere in a payslip filename, or None.

    Not anchored to the start: a folder from a different employer may prefix
    its payslips with a word, and those files still carry a usable month.
    """
    match = _MONTH_RE.search(os.path.basename(name))
    return match.group(1) if match else None


def resolve_password(folder: str, explicit: Optional[str]) -> Optional[str]:
    """Resolve a PDF password: explicit arg -> pin.txt in folder -> env var."""
    if explicit:
        return explicit
    pin_file = os.path.join(folder, "pin.txt")
    if os.path.isfile(pin_file):
        with open(pin_file, "r", encoding="utf-8") as fh:
            pin = fh.read().strip()
        if pin:
            return pin
    return os.getenv("PAYSLIP_PDF_PASSWORD")


def extract_text_lines(pdf_path: str, password: Optional[str]) -> List[str]:
    """Extract text lines from a (possibly encrypted) PDF using pypdf."""
    from pypdf import PdfReader

    reader = PdfReader(pdf_path)
    if reader.is_encrypted:
        if not password:
            raise PayslipDecryptError(f"{pdf_path} is encrypted but no password was provided")
        if reader.decrypt(password) == 0:
            raise PayslipDecryptError(f"Wrong password for {pdf_path}")
    text = "\n".join(page.extract_text() or "" for page in reader.pages)
    return [ln.strip() for ln in text.splitlines() if ln.strip()]


def parse_payslip(pdf_path: str, password: Optional[str] = None) -> Optional[PayslipRun]:
    """Parse a single payslip PDF into a PayslipRun, or None if unrecognized."""
    month = month_from_filename(pdf_path)
    if month is None:
        logger.warning("Cannot derive month from %s; skipping", pdf_path)
        return None
    lines = extract_text_lines(pdf_path, password)
    return parse_lines(lines, month=month, source_file=os.path.basename(pdf_path))
