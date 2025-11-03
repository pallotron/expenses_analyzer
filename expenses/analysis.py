from typing import List, Tuple

def calculate_trends(data: List[float]) -> List[Tuple[float, str]]:
    """
    Calculates the trend for a series of numbers by comparing each number
    to the previous one.

    Args:
        data: A list of numbers (floats or ints).

    Returns:
        A list of tuples, where each tuple contains the original number
        and a trend indicator ('↑', '↓', '=', or '-').
    """
    if not data:
        return []

    trends = [(data[0], '-')]  # First item has no trend
    for i in range(1, len(data)):
        previous = data[i-1]
        current = data[i]
        if current > previous:
            trend = '↑'
        elif current < previous:
            trend = '↓'
        else:
            trend = '='
        trends.append((current, trend))
    return trends
