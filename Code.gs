/**
 * オデンガ・テクノロジーズ — HPノート & プロンプト自動化パイプライン (Google Apps Script)
 * ------------------------------------------------------------------------
 * コンテンツ型は2種:
 *   note   … 実務ノート（Claudeが下書き生成）
 *   prompt … 使えるプロンプト（本文はTakeさんの実物。Claudeはタイトル/説明のみ整形）
 *
 * 流れ:
 *   1a) generateDraft()        … Claudeがノート下書き → posts に type=note, status=draft
 *   1b) generatePromptDraft()  … prompt_inbox の生プロンプト → Claudeがタイトル/説明整形
 *                                 → posts に type=prompt, status=draft（プロンプト本文はそのまま保持）
 *   2)  （人が承認）             … posts の status を approved に（＝人の一手 / E-E-A-T担保）
 *   3)  publishApproved()      … approved/published を集約 → posts.json を GitHub に反映
 *
 * 認証情報は「プロジェクトの設定 > スクリプト プロパティ」に保存（コード/リポジトリに直書きしない）:
 *   ANTHROPIC_API_KEY, CLAUDE_MODEL, GITHUB_TOKEN, GITHUB_REPO, GITHUB_BRANCH, GITHUB_PATH, POSTS_ON_HOMEPAGE
 *
 * ※ 文字列は日本語可読性・過去のトラブル回避のため「+」連結で組む方針。
 */

var SHEET_POSTS   = 'posts';
var SHEET_TOPICS  = 'topics';
var SHEET_INBOX   = 'prompt_inbox';
var DEFAULT_MODEL = 'claude-haiku-4-5-20251001'; // 品質重視なら 'claude-sonnet-5'
var CATEGORIES    = ['生成AI', 'DX', 'Power Platform', '補助金', '業務プロセス', 'セキュリティ'];
var POSTS_HEADER  = ['id', 'date', 'category', 'type', 'title', 'excerpt', 'body', 'prompt', 'art', 'status', 'topic'];

/* ============================================================ 設定ヘルパ */
function props_() { return PropertiesService.getScriptProperties(); }
function prop_(k, def) { var v = props_().getProperty(k); return (v === null || v === '') ? def : v; }
function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }
function sheet_(name) {
  var sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('シートが見つかりません: ' + name + '（先に setupSheets() を実行）');
  return sh;
}
function today_() { return Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd'); }

/* ============================================================ スプレッドシートのメニュー */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('ノート運用')
    .addItem('ノート下書きを生成', 'generateDraft')
    .addItem('プロンプト下書きを生成', 'generatePromptDraft')
    .addSeparator()
    .addItem('承認済みを公開', 'publishApproved')
    .addToUi();
}

/* ============================================================ 初期化 */
function setupSheets() {
  var ss = ss_();

  var posts = ss.getSheetByName(SHEET_POSTS) || ss.insertSheet(SHEET_POSTS);
  posts.clear();
  posts.getRange(1, 1, 1, POSTS_HEADER.length).setValues([POSTS_HEADER]).setFontWeight('bold');
  posts.setFrozenRows(1);

  var topics = ss.getSheetByName(SHEET_TOPICS) || ss.insertSheet(SHEET_TOPICS);
  topics.clear();
  topics.getRange(1, 1, 1, 3).setValues([['topic', 'angle', 'status']]).setFontWeight('bold');
  topics.setFrozenRows(1);
  topics.getRange(2, 1, 5, 3).setValues([
    ['中小製造業のペーパーレス化', '現場の抵抗をどう越えるか', 'pending'],
    ['生成AIの社内導入で最初にやること', 'PoCで終わらせない順番', 'pending'],
    ['ものづくり補助金とIT導入補助金の使い分け', '投資計画との接続', 'pending'],
    ['SharePointの社内ポータル設計', '"探す時間"を減らす情報設計', 'pending'],
    ['ZTNAで何が変わるか', '中小企業に現実的なゼロトラスト', 'pending']
  ]);

  var inbox = ss.getSheetByName(SHEET_INBOX) || ss.insertSheet(SHEET_INBOX);
  inbox.clear();
  inbox.getRange(1, 1, 1, 3).setValues([['prompt', 'note', 'status']]).setFontWeight('bold');
  inbox.setFrozenRows(1);
  // 使い方: prompt列に実際に効いたプロンプト本文を貼り、status=new にする（note列は任意メモ）
  inbox.getRange(2, 1, 1, 3).setValues([[
    '次の議事録から、実行すべきアクションアイテムだけを抽出し表にしてください。列は「タスク/担当/期限/優先度/補足」。不明な担当・期限は「要確認」と記載する。\n\n【議事録】\n（貼り付け）',
    '会議後の定番プロンプト', 'new'
  ]]);
}

/* ============================================================ 1a) ノート下書き生成 */
function generateDraft() {
  var topic = pickPending_(SHEET_TOPICS, 3); // {row, a, b} or null
  var draft = callClaudeForNote_(topic);
  var cat = (CATEGORIES.indexOf(draft.category) >= 0) ? draft.category : 'DX';
  appendPost_({
    type: 'note', category: cat, title: draft.title, excerpt: draft.excerpt,
    body: draft.body, prompt: '', topic: topic ? topic.a : '(auto)'
  });
  if (topic) markUsed_(SHEET_TOPICS, topic.row, 3);
  Logger.log('ノート下書きを追加: ' + draft.title);
}

function callClaudeForNote_(topic) {
  var theme = topic
    ? ('テーマ:「' + topic.a + '」／切り口:「' + topic.b + '」')
    : 'テーマ: 中小企業のDX・業務改善に関し、実務家として価値ある話題を1つ選ぶ';
  var sys =
    'あなたは「現場を知るITコンサルタント」オデンガ・テクノロジーズの代表として、' +
    '中小企業経営者向けの短いブログノートを書きます。IT/DX/生成AIと業務プロセスの両方が' +
    '分かる一次情報の視点を大切にし、誇張・断定・事実や数値の捏造をしないこと。';
  var usr =
    theme + '\n\n次の制約でノートを作成してください。\n' +
    '- 一人称、丁寧だが親しみのある実務家の語り\n' +
    '- title: 25文字前後、内容が具体的に分かる見出し\n' +
    '- excerpt: 60〜90文字、続きを読みたくなる要約（体言止め可）\n' +
    '- body: 400〜700文字、具体的な観点や順番・失敗例を含める\n' +
    '- category: 次から1つ [' + CATEGORIES.join(' / ') + ']\n\n' +
    '出力はJSONのみ。コードフェンス禁止。\n' +
    '形式: {"title":"...","excerpt":"...","body":"...","category":"..."}';
  var obj = JSON.parse(stripFences_(callClaude_(prop_('CLAUDE_MODEL', DEFAULT_MODEL), sys, usr, 1400)));
  if (!obj.title || !obj.excerpt || !obj.body) throw new Error('生成結果が不完全: ' + JSON.stringify(obj));
  return obj;
}

/* ============================================================ 1b) プロンプト下書き生成 */
function generatePromptDraft() {
  var item = pickPending_(SHEET_INBOX, 3); // {row, a=prompt, b=note} status列=3, 値は'new'を探す
  if (!item) { Logger.log('prompt_inbox に status=new の項目がありません。'); return; }
  var rawPrompt = String(item.a || '').trim();
  if (!rawPrompt) { markUsed_(SHEET_INBOX, item.row, 3); return; }

  var meta = describePrompt_(rawPrompt, item.b); // {title, excerpt, category} ※プロンプト本文は触らない
  var cat = (CATEGORIES.indexOf(meta.category) >= 0) ? meta.category : '生成AI';
  appendPost_({
    type: 'prompt', category: cat, title: meta.title, excerpt: meta.excerpt,
    body: '', prompt: rawPrompt, topic: '(prompt)'
  });
  markUsed_(SHEET_INBOX, item.row, 3);
  Logger.log('プロンプト下書きを追加: ' + meta.title);
}

// プロンプト本文からタイトル・説明・カテゴリのみ生成（本文は絶対に書き換えない）
function describePrompt_(rawPrompt, hint) {
  var sys =
    'あなたはプロンプト集の編集者です。与えられたプロンプトを読み、公開用のタイトルと短い説明を作ります。' +
    'プロンプト本文は改変・要約・出力しないこと。説明は用途が一目で分かるように。';
  var usr =
    (hint ? ('補足メモ:「' + hint + '」\n\n') : '') +
    '次のプロンプトに、公開用のメタ情報だけ付けてください。\n' +
    '- title: 25文字前後、「〜プロンプト」で終わる分かりやすい見出し\n' +
    '- excerpt: 60〜90文字、何に使えるかの説明\n' +
    '- category: 次から1つ [' + CATEGORIES.join(' / ') + ']\n\n' +
    '出力はJSONのみ（プロンプト本文は含めない）。コードフェンス禁止。\n' +
    '形式: {"title":"...","excerpt":"...","category":"..."}\n\n' +
    '【プロンプト】\n' + rawPrompt;
  var obj = JSON.parse(stripFences_(callClaude_(prop_('CLAUDE_MODEL', DEFAULT_MODEL), sys, usr, 500)));
  if (!obj.title || !obj.excerpt) throw new Error('メタ生成が不完全: ' + JSON.stringify(obj));
  return obj;
}

/* ============================================================ 共通: posts へ追加 */
function appendPost_(p) {
  var id = (p.type === 'prompt' ? 'q-' : 'n-') + Utilities.getUuid().slice(0, 8);
  var art = Math.floor(Math.random() * 4);
  sheet_(SHEET_POSTS).appendRow([
    id, today_(), p.category, p.type, p.title, p.excerpt, p.body, p.prompt, art, 'draft', p.topic
  ]);
}

/* ============================================================ pending選択 汎用 */
// statusCol(1-indexed) の値が 'pending' または 'new' の最初の行を返す
function pickPending_(sheetName, statusCol) {
  var sh = ss_().getSheetByName(sheetName);
  if (!sh) return null;
  var v = sh.getDataRange().getValues();
  for (var r = 1; r < v.length; r++) {
    var s = String(v[r][statusCol - 1]).toLowerCase();
    if (s === 'pending' || s === 'new') return { row: r + 1, a: v[r][0], b: v[r][1] };
  }
  return null;
}
function markUsed_(sheetName, row, statusCol) {
  ss_().getSheetByName(sheetName).getRange(row, statusCol).setValue('used');
}

/* ============================================================ 3) 公開 → posts.json */
function publishApproved() {
  var sh = sheet_(SHEET_POSTS);
  var values = sh.getDataRange().getValues();
  var col = {}; values[0].forEach(function (h, i) { col[h] = i; });

  var N = parseInt(prop_('POSTS_ON_HOMEPAGE', '12'), 10);
  var rows = [], approvedRows = [];

  for (var r = 1; r < values.length; r++) {
    var status = String(values[r][col.status]).toLowerCase();
    if (status === 'approved' || status === 'published') {
      rows.push({
        id: values[r][col.id],
        type: values[r][col.type] || 'note',
        date: Utilities.formatDate(new Date(values[r][col.date]), 'Asia/Tokyo', 'yyyy-MM-dd'),
        category: values[r][col.category],
        art: Number(values[r][col.art]) || 0,
        title: values[r][col.title],
        excerpt: values[r][col.excerpt],
        body: values[r][col.body] || '',
        prompt: values[r][col.prompt] || ''
      });
      if (status === 'approved') approvedRows.push(r + 1);
    }
  }
  if (!rows.length) { Logger.log('公開対象がありません。'); return; }

  rows.sort(function (a, b) { return a.date < b.date ? 1 : -1; });
  rows = rows.slice(0, N);

  commitToGitHub_(JSON.stringify({ lastUpdated: today_(), posts: rows }, null, 2));

  var statusCol = col.status + 1;
  approvedRows.forEach(function (row) { sh.getRange(row, statusCol).setValue('published'); });
  Logger.log('posts.json を公開（' + rows.length + '件）。');
}

/* ============================================================ Claude API */
function callClaude_(model, system, user, maxTokens) {
  var apiKey = prop_('ANTHROPIC_API_KEY', '');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY が未設定です。');
  var res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post', contentType: 'application/json',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    payload: JSON.stringify({
      model: model, max_tokens: maxTokens || 1200, system: system,
      messages: [{ role: 'user', content: user }]
    }),
    muteHttpExceptions: true
  });
  var code = res.getResponseCode(), text = res.getContentText();
  if (code < 200 || code >= 300) throw new Error('Anthropic APIエラー ' + code + ': ' + text);
  var data = JSON.parse(text), out = '';
  (data.content || []).forEach(function (b) { if (b.type === 'text') out += b.text; });
  return out;
}
function stripFences_(s) {
  if (!s) return s;
  return String(s).trim().replace(/^```[a-zA-Z]*\s*/, '').replace(/\s*```$/, '').trim();
}

/* ============================================================ GitHub Contents API */
function commitToGitHub_(contentStr) {
  var repo = prop_('GITHUB_REPO', ''), branch = prop_('GITHUB_BRANCH', 'main');
  var path = prop_('GITHUB_PATH', 'posts.json'), token = prop_('GITHUB_TOKEN', '');
  if (!repo || !token) throw new Error('GITHUB_REPO / GITHUB_TOKEN が未設定です。');
  var api = 'https://api.github.com/repos/' + repo + '/contents/' + encodeURIComponent(path);
  var headers = { 'Authorization': 'token ' + token, 'Accept': 'application/vnd.github+json', 'User-Agent': 'odenga-notes-bot' };

  var sha = null;
  var getRes = UrlFetchApp.fetch(api + '?ref=' + encodeURIComponent(branch), { method: 'get', headers: headers, muteHttpExceptions: true });
  if (getRes.getResponseCode() === 200) sha = JSON.parse(getRes.getContentText()).sha;

  var body = {
    message: 'chore(notes): update posts.json (' + today_() + ')',
    content: Utilities.base64Encode(contentStr, Utilities.Charset.UTF_8),
    branch: branch
  };
  if (sha) body.sha = sha;

  var putRes = UrlFetchApp.fetch(api, { method: 'put', headers: headers, contentType: 'application/json', payload: JSON.stringify(body), muteHttpExceptions: true });
  var code = putRes.getResponseCode();
  if (code < 200 || code >= 300) throw new Error('GitHub APIエラー ' + code + ': ' + putRes.getContentText());
}

/* ============================================================ トリガー（任意） */
function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var fn = t.getHandlerFunction();
    if (fn === 'generateDraft' || fn === 'generatePromptDraft' || fn === 'publishApproved') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('generateDraft').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(8).create();     // ノート 週1
  ScriptApp.newTrigger('generatePromptDraft').timeBased().onWeekDay(ScriptApp.WeekDay.THURSDAY).atHour(8).create(); // プロンプト 週1（inbox空ならno-op）
  ScriptApp.newTrigger('publishApproved').timeBased().everyDays(1).atHour(9).create();                          // 公開 日次
  Logger.log('トリガー設定完了（ノート=月 / プロンプト=木 / 公開=日次）。');
}

/* ============================================================ テスト用 */
function approveLatestDraft_() {
  var sh = sheet_(SHEET_POSTS), last = sh.getLastRow();
  var statusCol = POSTS_HEADER.indexOf('status') + 1;
  if (last > 1) sh.getRange(last, statusCol).setValue('approved');
}
