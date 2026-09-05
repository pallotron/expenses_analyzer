"""Euro-to-cents conversion, shared by every tool that touches money.

Kept in one place deliberately: the conversion looks trivial and is not, and two
tools disagreeing about it would produce differences that look like real bugs.
"""

from decimal import Decimal, ROUND_HALF_UP

import pandas as pd


def to_cents(amount) -> int:
    """Euros -> integer cents, rounding half away from zero.

    Goes via Decimal(str(x)) rather than arithmetic on the float. Multiplying
    first is wrong in a way that is easy to miss: 1.005 * 100 is 100.49999...
    in binary float, so any nudge-and-truncate loses the cent. str() gives the
    shortest string that round-trips the float, which is the value the user
    actually typed, and Decimal rounds that exactly.
    """
    if amount is None or pd.isna(amount):
        return 0
    return int(
        Decimal(str(float(amount))).scaleb(2).quantize(Decimal(1), rounding=ROUND_HALF_UP)
    )
