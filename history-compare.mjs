export function historyKey(entry) {
  return `${entry.repository}@${entry.commit}`;
}

export function createComparisonPreference(storage, field) {
  const memory = new Map();
  const normalize = (value) => {
    if (field === "query")
      return typeof value === "string" ? value.slice(0, 200) : undefined;
    if (field === "filter")
      return ["all", "added", "modified", "removed", "other"].includes(value)
        ? value
        : undefined;
    if (
      field === "dates" &&
      value &&
      typeof value.from === "string" &&
      typeof value.to === "string" &&
      value.from.length < 400 &&
      value.to.length < 400
    )
      return { from: value.from, to: value.to };
    return undefined;
  };
  const key = (id) =>
    `wc-office:comparison:v1:${encodeURIComponent(id)}:${field}`;
  return {
    get(id) {
      if (memory.has(id)) return memory.get(id);
      try {
        const value = normalize(
          JSON.parse(storage?.getItem(key(id)) || "null"),
        );
        memory.set(id, value);
        return value;
      } catch {
        return undefined;
      }
    },
    set(id, input) {
      const value = normalize(input);
      if (value === undefined) return;
      memory.set(id, value);
      try {
        storage?.setItem(key(id), JSON.stringify(value));
      } catch {
        /* Keep working when browser storage is unavailable. */
      }
    },
  };
}

export function restoreHistorySelection(entries, saved) {
  if (entries.length < 2) return null;
  const keys = entries.map(historyKey);
  if (saved && keys.includes(saved.from) && keys.includes(saved.to))
    return saved;
  return { from: keys[0], to: keys.at(-1) };
}

export function searchParts(text, query) {
  const term = query.trim();
  if (!term) return [{ text, match: false }];
  const pattern = new RegExp(
    term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    "giu",
  );
  const parts = [];
  let offset = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > offset)
      parts.push({ text: text.slice(offset, match.index), match: false });
    parts.push({ text: match[0], match: true });
    offset = match.index + match[0].length;
  }
  if (offset < text.length)
    parts.push({ text: text.slice(offset), match: false });
  return parts;
}

export function classifyChange(text, explicitType) {
  if (["added", "modified", "removed", "other"].includes(explicitType))
    return explicitType;
  // Legacy summaries have no structured type: only classify an unambiguous final action.
  const patterns = {
    added: /(?:추가|도입|신설|구현)(?:했습니다|하였습니다|했음|됨|함)?[.!。]?$/,
    modified:
      /(?:수정|개선|변경|조정|보완|최적화)(?:했습니다|하였습니다|했음|됨|함)?[.!。]?$/,
    removed: /(?:삭제|제거|폐지)(?:했습니다|하였습니다|했음|됨|함)?[.!。]?$/,
  };
  const value = text.trim();
  if (/(않|아니|없|예정|계획|필요)/.test(value)) return "other";
  const actions = Object.entries(patterns).filter(([, pattern]) =>
    pattern.test(value),
  );
  if (
    actions.length !== 1 ||
    /(?:추가|수정|삭제|제거|변경|개선)(?:하고|했으며|와|과|·|\/)/.test(value)
  )
    return "other";
  return actions[0][0];
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
  const categorized = [];
  for (const entry of interval) {
    const delta = entry.changeReport;
    if (
      delta?.state !== "changed" ||
      delta.from !== previous ||
      delta.to !== entry.commit
    )
      incomplete = true;
    if (delta?.state === "changed") {
      for (const [index, item] of (delta.items || []).entries()) {
        const type = classifyChange(item, delta.types?.[index]);
        if (!changes.includes(item)) changes.push(item);
        if (
          !categorized.some(
            (change) => change.text === item && change.type === type,
          )
        )
          categorized.push({ text: item, type });
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
    categorized,
    incomplete,
    count: interval.length,
    compareUrl:
      safeRepo && safeCommits
        ? `https://github.com/${before.repository}/compare/${before.commit}...${after.commit}`
        : null,
  };
}
