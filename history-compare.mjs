export function historyKey(entry) {
  return `${entry.repository}@${entry.commit}`;
}

export function compareHistory(history, fromKey, toKey) {
  const entries = [...history].sort(
    (a, b) => new Date(a.checkedAt) - new Date(b.checkedAt),
  );
  const start = entries.findIndex((entry) => historyKey(entry) === fromKey);
  const end = entries.findIndex((entry) => historyKey(entry) === toKey);
  if (start < 0 || end < 0)
    return { error: "비교할 기록을 두 개 선택해주세요." };
  if (start === end) return { error: "서로 다른 기록을 선택해주세요." };
  if (start > end)
    return { error: "시작 날짜보다 뒤의 종료 날짜를 선택해주세요." };
  const before = entries[start],
    after = entries[end];
  const interval = entries.slice(start + 1, end + 1);
  if (interval.some((entry) => entry.repository !== before.repository))
    return { error: "같은 GitHub 저장소의 기록끼리 비교해주세요." };
  let previous = before.commit;
  let incomplete = false;
  const changes = [];
  for (const entry of interval) {
    const delta = entry.changeReport;
    if (
      delta?.state !== "changed" ||
      delta.from !== previous ||
      delta.to !== entry.commit
    )
      incomplete = true;
    if (delta?.state === "changed") {
      for (const item of delta.items || []) {
        if (!changes.includes(item)) changes.push(item);
      }
    }
    previous = entry.commit;
  }
  const safeRepo = /^[\w.-]+\/[\w.-]+$/.test(before.repository);
  const safeCommits =
    /^[a-f0-9]{40}$/.test(before.commit) && /^[a-f0-9]{40}$/.test(after.commit);
  return {
    before,
    after,
    changes,
    incomplete,
    count: interval.length,
    compareUrl:
      safeRepo && safeCommits
        ? `https://github.com/${before.repository}/compare/${before.commit}...${after.commit}`
        : null,
  };
}
