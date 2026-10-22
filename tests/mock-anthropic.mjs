// "Claude simulado" para probar el flujo de IA sin clave ni coste.
// Imita POST /v1/messages con streaming (SSE). Uso:
//   node tests/mock-anthropic.mjs 4010
//   ANTHROPIC_API_KEY=x ANTHROPIC_BASE_URL=http://localhost:4010 npm start
// - Generar: devuelve la plantilla que recibe, renombrada.
// - Revisar ronda 1: dice que hay un problema y devuelve la animación con la cola/brazos algo cambiados.
// - Revisar ronda 2+: aprueba.
import http from 'node:http';

const port = Number(process.argv[2] || 4010);
const requests = [];

function reply(res, obj) {
  const text = JSON.stringify(obj);
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  ev('message_start', { message: { id: 'msg_mock', type: 'message', role: 'assistant', content: [], model: 'mock', stop_reason: null, stop_sequence: null, usage: { input_tokens: 1000, output_tokens: 1 } } });
  ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
  for (let i = 0; i < text.length; i += 4000) ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: text.slice(i, i + 4000) } });
  ev('content_block_stop', { index: 0 });
  ev('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: Math.round(text.length / 4) } });
  ev('message_stop', {});
  res.end();
}

http.createServer(async (req, res) => {
  let body = '';
  for await (const c of req) body += c;
  if (req.method === 'GET' && req.url === '/__requests') return res.end(JSON.stringify(requests));
  const json = JSON.parse(body);
  const content = json.messages[0].content;
  const blocks = typeof content === 'string' ? [{ type: 'text', text: content }] : content;
  const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const hasImage = blocks.some((b) => b.type === 'image');
  requests.push({ hasImage, model: json.model, format: json.output_config?.format?.type, chars: text.length });
  if (!hasImage) {
    const tpl = JSON.parse(text.split('<plantilla>')[1].split('</plantilla>')[0]);
    const anim = { name: `IA simulada: ${tpl.name}`, duration: tpl.duration, loop: tpl.loop, keyframes: tpl.keyframes.map((k) => ({
      time: k.time, easing: k.easing, grounded: k.grounded !== false, lift: k.lift || 0,
      root: { right: 0, up: 0, forward: 0, bend: 0, side: 0, twist: 0, ...k.root },
      poses: [...k.poses, { joint: 'HuesoInventado', bend: 1, side: 0, twist: 0 }],
    })) };
    return reply(res, anim);
  }
  const round = Number((text.match(/ronda (\d+) de 3/) || [])[1] || 1);
  if (round >= 2) return reply(res, { ok: true, problems: [], changes: '', animation: null });
  const anim = JSON.parse(text.split('ANIMACIÓN ACTUAL:\n')[1].split('\n\nRevisa con ojo')[0]);
  anim.keyframes.forEach((k) => {
    k.grounded = k.grounded !== false; k.lift = k.lift || 0;
    k.root = { right: 0, up: 0, forward: 0, bend: 0, side: 0, twist: 0, ...k.root };
    k.poses = k.poses.map((p) => ({ joint: p.joint, bend: p.bend * 0.8, side: p.side, twist: p.twist }));
  });
  return reply(res, { ok: false, problems: [{ type: 'ritmo', detail: 'Movimiento demasiado amplio (simulado).' }], changes: 'Reduzco un 20% los ángulos de doblar.', animation: anim });
}).listen(port, () => console.log(`Claude simulado en http://localhost:${port}`));
