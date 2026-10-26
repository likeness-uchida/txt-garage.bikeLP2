// 無料出張査定の申し込みを受け取り、Resend で担当者へ通知（＋任意でお客様へ自動返信）する
// 必要な環境変数: RESEND_API_KEY, MAIL_TO（通知先、カンマ区切り可）, MAIL_FROM（Resend で認証済みドメインのアドレス）
const rate = new Map(); // 接続元ごとの送信履歴（インスタンス内の簡易制限）

const ALLOWED_ORIGINS = [
  'https://bike.txt-garage.com',
  'https://bike-marketing.vercel.app',
  'https://txt-garage-bike-lp-2.vercel.app',
];

function clean(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
}
function bad(res, status, msg) {
  res.status(status).json({ ok: false, error: msg });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return bad(res, 405, 'method');

  const origin = req.headers.origin || '';
  if (origin && !ALLOWED_ORIGINS.includes(origin)) return bad(res, 403, 'origin');

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  const now = Date.now();
  const hist = (rate.get(ip) || []).filter(t => now - t < 10 * 60 * 1000);
  if (hist.length >= 5) return bad(res, 429, 'rate');
  hist.push(now); rate.set(ip, hist);

  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { return bad(res, 400, 'json'); } }
  if (!b || typeof b !== 'object') return bad(res, 400, 'body');

  // スパム対策：ハニーポット（人には見えない欄）に値があれば成功扱いで捨てる
  if (clean(b.website, 200)) return res.status(200).json({ ok: true });
  // スパム対策：フォーム表示から4秒未満、または6時間以上経過した送信は弾く
  const started = Number(b.started || 0);
  if (!started || now - started < 4000 || now - started > 6 * 60 * 60 * 1000) return bad(res, 400, 'timing');

  const name = clean(b.name, 50);
  const tel = clean(b.tel, 20).replace(/[^0-9]/g, '');
  const email = clean(b.email, 100);
  const postal = clean(b.postal, 10).replace(/[^0-9]/g, '');
  const address = clean(b.address, 120);
  const datetime = clean(b.datetime, 40);
  const maker = clean(b.maker, 30);
  const displacement = clean(b.displacement, 20);
  const model = clean(b.model, 60);

  if (!name || !tel || !postal) return bad(res, 400, 'required');
  if (!/^0\d{9,10}$/.test(tel)) return bad(res, 400, 'tel');
  if (!/^\d{7}$/.test(postal)) return bad(res, 400, 'postal');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return bad(res, 400, 'email');
  const joined = [name, address, datetime, maker, displacement, model].join(' ');
  if (/https?:\/\/|www\./i.test(joined)) return bad(res, 400, 'url');

  const key = process.env.RESEND_API_KEY, to = process.env.MAIL_TO, from = process.env.MAIL_FROM;
  if (!key || !to || !from) return bad(res, 500, 'config');

  const jst = new Date(now + 9 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 16);
  const lines = [
    '無料出張査定のお申し込みがありました。', '',
    `お名前：${name}`,
    `電話番号：${tel}`,
    `メール：${email || '（未入力）'}`,
    `郵便番号：${postal}`,
    `ご住所：${address || '（未取得）'}`,
    `ご希望日時：${datetime || '（指定なし）'}`, '',
    `メーカー：${maker || '（未選択）'}`,
    `排気量：${displacement || '（未選択）'}`,
    `車種：${model || '（未入力）'}`, '',
    `受付日時：${jst}（JST）`,
  ];
  const send = (payload) => fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const r1 = await send({
    from,
    to: to.split(',').map(s => s.trim()).filter(Boolean),
    reply_to: email || undefined,
    subject: `【バイク買取りLP】無料出張査定のお申し込み（${name} 様）`,
    text: lines.join('\n'),
  });
  if (!r1.ok) return bad(res, 502, 'send');

  if (email) {
    await send({
      from,
      to: [email],
      subject: '【ティーバイティーガレージ】無料出張査定のお申し込みを受け付けました',
      text: [
        `${name} 様`, '',
        'この度はティーバイティーガレージの無料出張査定にお申し込みいただき、ありがとうございます。',
        '担当者より折り返しご連絡いたしますので、しばらくお待ちください。', '',
        '【お申し込み内容】',
        `電話番号：${tel}`,
        `郵便番号：${postal}`,
        `ご希望日時：${datetime || '（指定なし）'}`,
        `メーカー：${maker || '（未選択）'}／排気量：${displacement || '（未選択）'}／車種：${model || '（未入力）'}`, '',
        'お急ぎの方はフリーダイヤル 0120-999-999（受付 8:00〜20:00）までお電話ください。', '',
        '※このメールは自動送信です。心当たりのない場合は破棄してください。',
      ].join('\n'),
    }).catch(() => {});
  }
  return res.status(200).json({ ok: true });
};
