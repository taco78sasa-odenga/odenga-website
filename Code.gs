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
  var MANAGED = ['generateDraft', 'generatePromptDraft', 'publishApproved', 'weeklyReminder', 'checkSiteHealth', 'collectTrends'];
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (MANAGED.indexOf(t.getHandlerFunction()) !== -1) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('generateDraft').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(8).create();
  ScriptApp.newTrigger('generatePromptDraft').timeBased().onWeekDay(ScriptApp.WeekDay.THURSDAY).atHour(8).create();
  ScriptApp.newTrigger('publishApproved').timeBased().everyDays(1).atHour(9).create();
  ScriptApp.newTrigger('weeklyReminder').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(21).create();
  ScriptApp.newTrigger('checkSiteHealth').timeBased().everyDays(1).atHour(21).create();
  ScriptApp.newTrigger('collectTrends').timeBased().everyDays(1).atHour(7).create();
  Logger.log('トリガー設定完了（ノート=月朝 / プロンプト=木朝 / 公開=日次朝 / トレンド=毎朝7時 / リマインド=月夜 / 監視=日次夜）。');
}

/* ============================================================ 週次リマインド */
function weeklyReminder() {
  var TO  = 'sasaki78@odenga.com';
  var CC  = 'sasaki78@odenga.onmicrosoft.com';
  var sh  = sheet_(SHEET_POSTS);
  var data = sh.getDataRange().getValues();
  var statusIdx = POSTS_HEADER.indexOf('status');
  var titleIdx  = POSTS_HEADER.indexOf('title');
  var drafts = [];
  for (var i = 1; i < data.length; i++) {
    if (data[i][statusIdx] === 'draft') drafts.push('・' + data[i][titleIdx]);
  }
  var body = drafts.length > 0
    ? '承認待ちの下書きが ' + drafts.length + ' 件あります。\n\n' + drafts.join('\n') + '\n\nスプレッドシートで status を approved に変更してください。'
    : '現在、承認待ちの下書きはありません。\n\n今週のネタを topics シートに追加しておくと、次回の generateDraft() で下書きが生成されます。';
  GmailApp.sendEmail(TO, '【オデンガHP】週次コンテンツリマインド', body, { cc: CC });
  Logger.log('週次リマインドメール送信完了。');
}

/* ============================================================ サイト死活監視 */
function checkSiteHealth() {
  var TO   = 'sasaki78@odenga.com';
  var CC   = 'sasaki78@odenga.onmicrosoft.com';
  var URL  = 'https://odenga.com';
  var code, err;
  try {
    var res = UrlFetchApp.fetch(URL, { muteHttpExceptions: true });
    code = res.getResponseCode();
  } catch (e) {
    err = e.toString();
  }
  if (err || code !== 200) {
    var msg = err ? 'アクセスエラー: ' + err : 'HTTPステータス ' + code + ' が返されました。';
    GmailApp.sendEmail(TO, '【緊急】odenga.com が応答していません', msg + '\n\nURL: ' + URL, { cc: CC });
    Logger.log('異常検知 → メール送信: ' + msg);
  } else {
    Logger.log('サイト正常: ' + URL + ' (' + code + ')');
  }
}

/* ============================================================ トレンド収集・スコアリング */

var TREND_SHEET = 'trends';
var TREND_HEADER = ['date', 'keyword', 'count', 'relevance', 'comment', 'sources'];

var RSS_SOURCES = [
  { name: 'ITmedia AI+',       url: 'https://rss.itmedia.co.jp/rss/2.0/aiplus.xml' },
  { name: 'ITmedia NEWS',      url: 'https://rss.itmedia.co.jp/rss/2.0/news_bursts.xml' },
  { name: 'Zenn トレンド',      url: 'https://zenn.dev/feed' },
  { name: '日経クロステック',    url: 'https://xtech.nikkei.com/rss/xtech-it.rdf' },
  { name: 'NHK ビジネス',       url: 'https://www.nhk.or.jp/rss/news/cat4.xml' },
  { name: 'Microsoft Japan',   url: 'https://techcommunity.microsoft.com/plugins/custom/microsoft/o365/rss-board?board.id=microsoft365blog' }
];

var WATCH_KEYWORDS = [
  '生成AI', 'ChatGPT', 'Claude', 'Copilot', 'LLM',
  'DX', 'デジタル変革', 'Power Automate', 'Power Platform', 'RPA',
  '補助金', 'IT導入補助金', 'ものづくり補助金',
  '業務効率化', '自動化', 'ペーパーレス',
  'セキュリティ', 'サイバー攻撃', 'ゼロトラスト',
  'クラウド', 'Azure', 'Microsoft 365',
  '中小企業', 'スタートアップ', 'ERP'
];

function collectTrends() {
  var today = today_();
  var counts = {};
  var sources = {};
  WATCH_KEYWORDS.forEach(function(k) { counts[k] = 0; sources[k] = []; });

  RSS_SOURCES.forEach(function(src) {
    try {
      var res = UrlFetchApp.fetch(src.url, { muteHttpExceptions: true, followRedirects: true });
      if (res.getResponseCode() !== 200) return;
      var xml = res.getContentText('UTF-8');
      WATCH_KEYWORDS.forEach(function(k) {
        var re = new RegExp(k, 'gi');
        var matches = xml.match(re);
        if (matches && matches.length > 0) {
          counts[k] += matches.length;
          if (sources[k].indexOf(src.name) === -1) sources[k].push(src.name);
        }
      });
    } catch(e) {
      Logger.log('RSS取得エラー(' + src.name + '): ' + e);
    }
  });

  // 出現数が1件以上のキーワードを抽出しClaudeでスコアリング
  var hits = WATCH_KEYWORDS.filter(function(k) { return counts[k] > 0; })
    .sort(function(a, b) { return counts[b] - counts[a]; })
    .slice(0, 20);

  if (hits.length === 0) { Logger.log('トレンドキーワード該当なし'); return; }

  var scored = scoreTrends_(hits, counts, sources, today);
  saveTrends_(scored, today);
  publishTrends_();
  Logger.log('トレンド収集・公開完了: ' + hits.length + ' キーワード');
}

function scoreTrends_(hits, counts, sources, today) {
  var list = hits.map(function(k) {
    return k + '（' + counts[k] + '件 / ' + sources[k].join('・') + '）';
  }).join('\n');

  var prompt = '以下は本日(' + today + ')の日本のITニュースRSSで頻出したキーワード一覧です。\n\n'
    + list + '\n\n'
    + '各キーワードについて、日本の中小企業（従業員数〜300名、製造・商社・サービス業）への関連度を評価してください。\n'
    + '必ずJSON配列のみを返してください（説明文不要）。形式:\n'
    + '[{"keyword":"キーワード","relevance":"高|中|低","comment":"中小企業視点での一言（30字以内）"}]';

  var model = prop_('CLAUDE_MODEL', DEFAULT_MODEL);
  var apiKey = prop_('ANTHROPIC_API_KEY', '');
  var payload = {
    model: model,
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }]
  };
  var res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  var json = JSON.parse(res.getContentText());
  var text = json.content && json.content[0] ? json.content[0].text : '[]';
  // JSON部分だけ抽出
  var match = text.match(/\[[\s\S]*\]/);
  var scored = match ? JSON.parse(match[0]) : [];
  // countとsourcesをマージ
  scored.forEach(function(item) {
    item.count = counts[item.keyword] || 0;
    item.sources = (sources[item.keyword] || []).join('・');
    item.date = today;
  });
  return scored;
}

function saveTrends_(scored, today) {
  var ss = ss_();
  var sh = ss.getSheetByName(TREND_SHEET);
  if (!sh) {
    sh = ss.insertSheet(TREND_SHEET);
    sh.appendRow(TREND_HEADER);
  }
  // 当日分を削除して上書き
  var data = sh.getDataRange().getValues();
  for (var i = data.length - 1; i >= 1; i--) {
    if (data[i][0] === today) sh.deleteRow(i + 1);
  }
  scored.forEach(function(item) {
    sh.appendRow([item.date, item.keyword, item.count, item.relevance, item.comment, item.sources]);
  });
}

function publishTrends_() {
  var sh = ss_().getSheetByName(TREND_SHEET);
  if (!sh) return;
  var data = sh.getDataRange().getValues();
  var header = data[0];
  var dateIdx = header.indexOf('date');
  var kwIdx   = header.indexOf('keyword');
  var cntIdx  = header.indexOf('count');
  var relIdx  = header.indexOf('relevance');
  var comIdx  = header.indexOf('comment');
  var srcIdx  = header.indexOf('sources');

  // 直近7日分を収集
  var byDate = {};
  for (var i = 1; i < data.length; i++) {
    var d = data[i][dateIdx];
    if (!d) continue;
    if (!byDate[d]) byDate[d] = [];
    byDate[d].push({
      keyword:   data[i][kwIdx],
      count:     data[i][cntIdx],
      relevance: data[i][relIdx],
      comment:   data[i][comIdx],
      sources:   data[i][srcIdx]
    });
  }
  var dates = Object.keys(byDate).sort().reverse();
  var daily  = dates[0] ? byDate[dates[0]] : [];
  // Weekly: 直近7日分のキーワードをcount合計
  var weeklyMap = {};
  dates.slice(0, 7).forEach(function(d) {
    byDate[d].forEach(function(item) {
      if (!weeklyMap[item.keyword]) weeklyMap[item.keyword] = { count: 0, relevance: item.relevance, comment: item.comment };
      weeklyMap[item.keyword].count += item.count;
    });
  });
  var weekly = Object.keys(weeklyMap).map(function(k) {
    return { keyword: k, count: weeklyMap[k].count, relevance: weeklyMap[k].relevance, comment: weeklyMap[k].comment };
  }).sort(function(a, b) { return b.count - a.count; }).slice(0, 15);

  var trendJson = {
    updatedAt: dates[0] || today_(),
    daily:  daily.slice(0, 15),
    weekly: weekly
  };

  // trends.json を GitHub に push
  var repo   = prop_('GITHUB_REPO', '');
  var branch = prop_('GITHUB_BRANCH', 'main');
  var token  = prop_('GITHUB_TOKEN', '');
  if (!repo || !token) { Logger.log('GITHUB設定なし、trends.json公開スキップ'); return; }

  var apiUrl = 'https://api.github.com/repos/' + repo + '/contents/trends.json';
  var current;
  try {
    var get = UrlFetchApp.fetch(apiUrl, {
      headers: { Authorization: 'token ' + token, Accept: 'application/vnd.github.v3+json' },
      muteHttpExceptions: true
    });
    current = JSON.parse(get.getContentText());
  } catch(e) { current = {}; }

  var body = {
    message: 'chore: update trends.json (' + trendJson.updatedAt + ')',
    content: Utilities.base64Encode(JSON.stringify(trendJson, null, 2), Utilities.Charset.UTF_8),
    branch:  branch
  };
  if (current.sha) body.sha = current.sha;

  UrlFetchApp.fetch(apiUrl, {
    method: 'put',
    contentType: 'application/json',
    headers: { Authorization: 'token ' + token, Accept: 'application/vnd.github.v3+json' },
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });
}

/* ============================================================ テスト用 */
function approveLatestDraft_() {
  var sh = sheet_(SHEET_POSTS), last = sh.getLastRow();
  var statusCol = POSTS_HEADER.indexOf('status') + 1;
  if (last > 1) sh.getRange(last, statusCol).setValue('approved');
}
