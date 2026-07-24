"""Pure parsing of Irish PAYE payslip text into structured records.

PDF I/O lives in extract functions further down; the ``parse_lines`` logic is
kept pure (operates on text) so it is unit-testable without PDF fixtures.
"""
import logging
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
    pension_ee: float = 0.0
    avc: float = 0.0
    pension_er: float = 0.0
    paye: float = 0.0
    prsi_ee: float = 0.0
    usc: float = 0.0
    pension_ee_ytd: float = 0.0
    avc_ytd: float = 0.0
    pension_er_ytd: float = 0.0

    @property
    def gross(self) -> float:
        """Cash earnings (excludes notional BIK)."""
        return round(self.salary + self.bonus + self.oncall + self.reimbursements, 2)

    @property
    def tax_total(self) -> float:
        return round(self.paye + self.prsi_ee + self.usc, 2)

    @property
    def deds_from_gross(self) -> float:
        return round(self.pension_ee + self.avc, 2)

    @property
    def net(self) -> float:
        return round(self.gross - self.deds_from_gross - self.tax_total, 2)


def _handle_salary(run: PayslipRun, nums: List[float]) -> bool:
    """Handle Salary line. Returns True if matched."""
    if nums:
        run.salary = nums[0]
        return True
    return False


def _handle_bonus(run: PayslipRun, nums: List[float]) -> bool:
    """Handle Bonus line."""
    if nums:
        run.bonus = nums[0]
    return False


def _handle_oncall(run: PayslipRun, nums: List[float]) -> bool:
    """Handle On-Call line."""
    if nums:
        run.oncall = nums[0]
    return False


def _handle_device_reimbursement(run: PayslipRun, nums: List[float]) -> bool:
    """Handle Device Reimbursement line."""
    if nums:
        run.reimbursements += nums[0]
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


def parse_lines(lines: List[str], month: str, source_file: str) -> Optional[PayslipRun]:
    """Parse stripped payslip text lines into a PayslipRun.

    Returns None if the Irish-format signature is absent (a Salary line and a
    Pension line carrying >= 4 amounts). This is the "fail loudly" guard: an
    unrecognized layout is never guessed at.
    """
    run = PayslipRun(month=month, source_file=source_file)
    saw_salary = False
    saw_pension = False

    handlers = [
        ("Salary", _handle_salary),
        ("Bonus", _handle_bonus),
        ("On-Call", _handle_oncall),
        ("Device Reimbursement", _handle_device_reimbursement),
        ("AVC", _handle_avc),
        ("Pension", _handle_pension),
        ("PAYE", _handle_paye),
        ("PRSI", _handle_prsi),
        ("USC", _handle_usc),
    ]

    for raw in lines:
        line = raw.strip()
        nums = extract_amounts(line)

        for prefix, handler in handlers:
            if line.startswith(prefix):
                result = handler(run, nums)
                if prefix == "Salary" and result:
                    saw_salary = True
                elif prefix == "Pension" and result:
                    saw_pension = True
                break

    if not (saw_salary and saw_pension):
        logger.warning("Unrecognized payslip format for %s; skipping", source_file)
        return None
    return run
