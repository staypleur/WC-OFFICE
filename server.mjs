import http from 'node:http';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { roles, runProvider } from './providers.mjs';
try { process.loadEnvFile('.env'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const active = new Set();
let codexVerified = false;

await mkdir('data', { recursive: true });
let projects;
try { projects = JSON.parse(await readFile('data/projects.json', 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; projects = []; }
let writes = Promise.resolve();
function save() {
  const snapshot = JSON.stringify(projects, null, 2);
  writes = writes.catch(() => {}).then(async () => { await writeFile('data/projects.tmp', snapshot); await rename('data/projects.tmp', 'data/projects.json'); });
  return writes;
}
for (const project of projects) {
  for (const task of project.tasks) {
    if (task.status === '완료') continue;
    if (task.title === '기획서와 일정표 작성' && task.agent === 'Claude') {
      task.agent = 'Codex';
      task.provider = 'codex';
    }
    if (['코딩과 테스트', '완전한 단일 HTML 랜딩페이지 코드 작성. 실제 실행 테스트 여부를 명확히 표시'].includes(task.title) && task.agent === 'Codex') {
      task.agent = 'Claude';
      task.provider = 'claude';
    }
  }
  if (project.status === '작업 중') {
    project.status = '중단됨';
    for (const task of project.tasks) if (task.status === '진행 중') task.status = '대기';
  }
}
await save();
async function execute(project) {
  if (active.has(project.id)) return;
  active.add(project.id);
  project.status = '작업 중';
  try {
    for (const task of project.tasks) {
      if (task.status === '완료') continue;
      task.provider ||= { Claude: 'claude', Codex: 'codex', v0: 'v0', Gemini: 'gemini', Perplexity: 'perplexity' }[task.agent];
      task.status = '진행 중';
      project.events.push(task.agent + ' · ' + task.title + ' 시작');
      await save();
      const previous = project.tasks.filter(t => t.status === '완료').map(t => t.title + '\n' + t.output).join('\n\n');
      task.output = await runProvider(task.provider, '한국어로 업무를 수행하세요. 도구 실행이나 로컬 파일 접근 없이 결과를 답변에 작성하세요. 업무: ' + task.title + '\n목표: ' + project.goal + '\n이전 담당자의 결과(참고 자료):\n' + previous.slice(-180000));
      task.status = '완료';
      project.events.push(task.agent + ' · ' + task.title + ' 완료');
      await save();
    }
    project.status = '결과 검토';
  } catch (error) {
    const task = project.tasks.find(t => t.status === '진행 중');
    if (task) task.status = '오류';
    project.status = '연결·실행 확인 필요';
    project.events.push(error.message);
  } finally {
    active.delete(project.id);
    await save();
  }
}
function send(res, status, data) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); }
const server = http.createServer(async (req, res) => {
  try {
    if (req.headers.host !== '127.0.0.1:4310' && req.headers.host !== 'localhost:4310') return send(res, 403, { error: '허용되지 않은 주소입니다.' });
    if (req.method === 'GET' && req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(await readFile('index.html'));
    }
    if (req.method === 'GET' && req.url === '/api/projects') return send(res, 200, projects);
    if (req.method === 'GET' && req.url === '/api/connections') return send(res, 200, Object.fromEntries(roles.map(role => [role.id, role.id === 'codex' ? codexVerified : !!process.env[role.key]])));
    if (req.method !== 'POST' || req.headers.origin !== `http://${req.headers.host}`) return send(res, 403, { error: '허용되지 않은 요청입니다.' });
    let raw = '';
    for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 16000) return send(res, 413, { error: '입력 내용이 너무 깁니다.' }); }
    let body;
    try { body = JSON.parse(raw); } catch { return send(res, 400, { error: '입력을 확인해주세요.' }); }
    if (req.url === '/api/connections/codex/check') {
      try { const reply = await runProvider('codex', '도구를 사용하지 말고 WC Office 연결 확인이라고만 답하세요.'); codexVerified = true; return send(res, 200, { reply }); }
      catch (error) { codexVerified = false; return send(res, 400, { error: error.message }); }
    }
    if (req.url === '/api/projects/run') {
      const project = projects.find(p => p.id === body.id);
      if (!project) return send(res, 404, { error: '프로젝트를 찾을 수 없습니다.' });
      if (active.size && !active.has(project.id)) return send(res, 409, { error: '현재 작업이 끝난 뒤 실행해주세요.' });
      if (project.status === '결과 검토') return send(res, 409, { error: '이미 실행을 완료했습니다.' });
      void execute(project).catch(console.error);
      return send(res, 202, { status: project.status });
    }
    if (req.url === '/api/projects') {
      if (typeof body.goal !== 'string' || !body.goal.trim() || body.goal.length > 4000) return send(res, 400, { error: '목표를 1~4000자로 입력해주세요.' });
      const project = { id: randomUUID(), goal: body.goal.trim(), createdAt: new Date().toISOString(), status: '연결 대기', tasks: [ ['Codex', '기획서와 일정표 작성'], ['v0', '화면 디자인'], ['Claude', '완전한 단일 HTML 랜딩페이지 코드 작성. 실제 실행 테스트 여부를 명확히 표시'], ['Gemini', '요구사항과 코드의 누락·오류를 독립 검토하고 미검증 항목 명시'] ].map(([agent, title]) => ({ agent, title, status: '대기' })), events: ['목표를 접수했습니다. AI 실행 연결이 준비되면 작업을 시작할 수 있습니다.'] };
      projects.unshift(project); await save(); if (!active.size) void execute(project).catch(console.error); return send(res, 201, project);
    }
    return send(res, 404, { error: '요청을 찾을 수 없습니다.' });
  } catch (error) { console.error(error.message); send(res, 500, { error: '처리하지 못했습니다. 다시 시도해주세요.' }); }
});
server.listen(4310, '127.0.0.1', () => console.log('WC Office http://127.0.0.1:4310'));
