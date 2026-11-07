import http from 'node:http';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

await mkdir('data', { recursive: true });
let projects;
try { projects = JSON.parse(await readFile('data/projects.json', 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; projects = []; }
let writes = Promise.resolve();
function save() {
  const snapshot = JSON.stringify(projects, null, 2);
  writes = writes.then(async () => { await writeFile('data/projects.tmp', snapshot); await rename('data/projects.tmp', 'data/projects.json'); });
  return writes;
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
    if (req.method === 'GET' && req.url === '/api/connections') return send(res, 200, { claude: !!process.env.ANTHROPIC_API_KEY, v0: !!process.env.V0_API_KEY, codex: !!process.env.OPENAI_API_KEY });
    if (req.method !== 'POST' || req.headers.origin !== `http://${req.headers.host}`) return send(res, 403, { error: '허용되지 않은 요청입니다.' });
    let raw = '';
    for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 16000) return send(res, 413, { error: '입력 내용이 너무 깁니다.' }); }
    let body;
    try { body = JSON.parse(raw); } catch { return send(res, 400, { error: '입력을 확인해주세요.' }); }
    if (req.url === '/api/projects') {
      if (typeof body.goal !== 'string' || !body.goal.trim() || body.goal.length > 4000) return send(res, 400, { error: '목표를 1~4000자로 입력해주세요.' });
      const project = { id: randomUUID(), goal: body.goal.trim(), createdAt: new Date().toISOString(), status: '연결 대기', tasks: [ ['Claude', '기획서와 일정표 작성'], ['v0', '화면 디자인'], ['Codex', '코딩과 테스트'], ['Claude', '최종 검수'] ].map(([agent, title]) => ({ agent, title, status: '대기' })), events: ['목표를 접수했습니다. AI 실행 연결이 준비되면 작업을 시작할 수 있습니다.'] };
      projects.unshift(project); await save(); return send(res, 201, project);
    }
    return send(res, 404, { error: '요청을 찾을 수 없습니다.' });
  } catch (error) { console.error(error.message); send(res, 500, { error: '처리하지 못했습니다. 다시 시도해주세요.' }); }
});
server.listen(4310, '127.0.0.1', () => console.log('WC OFFICE http://127.0.0.1:4310'));
