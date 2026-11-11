export function diffLines(before, after) {
  if (before === after)
    return { rows: [], added: 0, removed: 0, truncated: false };
  const a = before ? before.split("\n") : [],
    b = after ? after.split("\n") : [];
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length,
    endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const rows = [];
  let added = 0,
    removed = 0;
  const push = (kind, text, line) => {
    if (kind === "add") added++;
    if (kind === "remove") removed++;
    if (rows.length < 1500) rows.push({ kind, text, line });
  };
  for (let i = Math.max(0, start - 3); i < start; i++)
    push("same", a[i], i + 1);
  const n = endA - start,
    m = endB - start;
  if (n * m > 360000) {
    for (let i = start; i < endA; i++) push("remove", a[i], i + 1);
    for (let j = start; j < endB; j++) push("add", b[j], j + 1);
  } else {
    const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        dp[i][j] =
          a[start + i] === b[start + j]
            ? dp[i + 1][j + 1] + 1
            : Math.max(dp[i + 1][j], dp[i][j + 1]);
    let i = 0,
      j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && a[start + i] === b[start + j]) {
        push("same", a[start + i], start + i + 1);
        i++;
        j++;
      } else if (i < n && (j === m || dp[i + 1][j] >= dp[i][j + 1])) {
        push("remove", a[start + i], start + i + 1);
        i++;
      } else {
        push("add", b[start + j], start + j + 1);
        j++;
      }
    }
  }
  for (let i = endB; i < Math.min(b.length, endB + 3); i++)
    push("same", b[i], i + 1);
  return {
    rows,
    added,
    removed,
    truncated: rows.length >= 1500,
    coarse: n * m > 360000,
  };
}
