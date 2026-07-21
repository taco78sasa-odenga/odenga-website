# NOTES 自動化パイプライン — セットアップ & 運用ガイド

HPの「現場からのノート」と「使えるプロンプト」を、**下書き（半自動）→ 人が承認 → 自動公開**で回す仕組みです。
既存のニュースレター基盤（GAS × Claude API × スプレッドシート）と同じ考え方で構成しています。

```
[週1・月] generateDraft()        Claudeがノート下書き → posts(type=note, status=draft)
[週1・木] generatePromptDraft()  prompt_inbox の実プロンプト → Claudeがタイトル/説明を整形
                                  → posts(type=prompt, status=draft) ※本文は改変しない
[人が2分レビュー]  status を approved に変更     ← E-E-A-Tと信頼の担保
[日次]    publishApproved()      approved/published を集約 → posts.json を GitHub に PUT
[HP] index.html が posts.json を読み、ノート最新3件＋プロンプト最新4件＋最終更新日を表示
```

> **なぜ全自動にしないか**：Googleの「scaled content abuse」方針は、AI/人手を問わず“価値の薄い量産”を
> 対象に強く運用されています（2026年3月コアアップデートで最優先ターゲット）。専門性で売るサイトほど、
> 弱い記事1本の信頼ダメージが大きい。**公開前に人が一度目を通す**運用が、安全と品質の分岐点です。

---

## 1. ファイル構成
| ファイル | 役割 | 置き場所 |
|---|---|---|
| `index.html` | HP本体（ノート表示部を内蔵） | サイトのルート |
| `posts.json` | 公開記事データ（GASが上書き） | サイトのルート（`index.html`と同階層） |
| `Code.gs` | GAS本体 | Apps Scriptプロジェクト |

`index.html` は `posts.json` を**相対パス**で読みます。GitHub Pages等、同一オリジンに両方を置けば動作します。
（ローカルの `file://` では取得できないため、その場合はHTML内蔵の SEED を自動表示します。）

## 2. スプレッドシート準備
1. 新規スプレッドシートを作成 → 拡張機能 > Apps Script。
2. `Code.gs` の内容を貼り付け保存。
3. エディタで **`setupSheets()` を1回実行**。`posts` / `topics` / `prompt_inbox` シートが作られます。
   - `posts`: `id | date | category | type | title | excerpt | body | prompt | art | status | topic`
   - `topics`: `topic | angle | status(pending/used)` … ノートの題材キュー（初期5件入り）
   - `prompt_inbox`: `prompt | note | status(new/used)` … **プロンプト投入箱**（後述）

## 3. スクリプト プロパティ設定
プロジェクトの設定 > スクリプト プロパティ に登録（**コードやリポジトリに鍵を直書きしない**）:

| キー | 値の例 | 備考 |
|---|---|---|
| `ANTHROPIC_API_KEY` | sk-ant-... | Anthropic APIキー |
| `CLAUDE_MODEL` | `claude-haiku-4-5-20251001` | 品質重視なら `claude-sonnet-5` |
| `GITHUB_TOKEN` | github_pat_... | Fine-grained PAT。対象リポジトリの **Contents: Read and write** のみ |
| `GITHUB_REPO` | `taco78sasa-odenga/odenga-hp` | owner/repo |
| `GITHUB_BRANCH` | `main` | Pages公開ブランチ |
| `GITHUB_PATH` | `posts.json` | 出力先パス |
| `POSTS_ON_HOMEPAGE` | `12` | posts.jsonに載せる件数（任意） |

## 4. 動作テスト
1. `generateDraft()` を実行 → `posts` シートに `status=draft` の行が増える。内容を確認。
2. 良ければその行の `status` を **`approved`** に変更（＝承認）。必要なら文面を手直し。
3. `publishApproved()` を実行 → `posts.json` がGitHubに反映され、`status` が `published` に。
4. サイト（GitHub Pages等）を開き、ノート最新3件と「最終更新」が更新されているか確認。

## 4b. プロンプトを公開する（“いいプロンプトをどんどん”用）
プロンプトは**AIに作らせず、実際に効いたものを載せる**のが価値の源泉です。
1. `prompt_inbox` シートの `prompt` 列に、実プロンプト本文を貼る（`note` 列に用途メモ、`status` を `new`）。
2. `generatePromptDraft()` を実行 → Claudeが**タイトル・説明・カテゴリだけ**を整形し、
   `posts` に `type=prompt, status=draft` で追加（**プロンプト本文はそのまま保持・改変しない**）。
3. `posts` の該当行を確認し、良ければ `status=approved` に。
4. `publishApproved()` で公開 → HPの「使えるプロンプト」に、**コピーボタン付き**で最新4件が表示されます。

> スプレッドシート上部の「ノート運用」メニュー（`onOpen`）からも各処理を実行できます。

## 5. 自動化
`installTriggers()` を実行すると:
- **ノート下書き**: 毎週月曜 8:00（`generateDraft`）
- **プロンプト下書き**: 毎週木曜 8:00（`generatePromptDraft`、`prompt_inbox` が空なら何もしない）
- **公開**: 毎日 9:00（`publishApproved`）

頻度は関数内の `onWeekDay/atHour/everyDays` で調整可。**毎日全自動生成は非推奨**（前述の理由）。
週1〜2本の下書きを、承認したものだけ公開する運用が安全でおすすめです。

## 6. 運用ルール（重要）
- **一次情報を核に**：実案件で得た知見・順番・失敗例など、Takeさんにしか書けない内容に寄せる（E-E-A-Tで有利）。
- **承認は必須**：AI下書きは叩き台。事実確認と“自分の言葉”への微修正を挟む。
- **画像は増やしすぎない**：HPは記事ごとに4種のオンブランドSVGモチーフ（`art: 0〜3`）を使い回し。
  汎用イラストの量産より“らしさ”が出て、コスト0・表示も高速。
- **守秘**：顧客名・具体数値の捏造をしない（プロンプトでも禁止済み）。

## 7. `posts.json` スキーマ
```json
{
  "lastUpdated": "2026-07-17",
  "posts": [
    {
      "id": "n-1a2b3c4d",
      "type": "note",
      "date": "2026-07-15",
      "category": "生成AI",
      "art": 0,
      "title": "見出し（25字前後）",
      "excerpt": "要約（60〜90字）",
      "body": "本文（記事詳細ページ用に保持。一覧では未使用）",
      "prompt": ""
    },
    {
      "id": "q-9f8e7d6c",
      "type": "prompt",
      "date": "2026-07-14",
      "category": "業務プロセス",
      "art": 3,
      "title": "〜プロンプト",
      "excerpt": "何に使えるかの説明",
      "body": "",
      "prompt": "実際のプロンプト本文（コピーボタンでコピーされる）"
    }
  ]
}
```
- `type`: `note`（実務ノート）または `prompt`（コピー用プロンプト）。
- ノート一覧が使うのは `date / category / art / title / excerpt`、プロンプトは加えて `prompt`。
- `art` は 0〜3（SVGモチーフ：0=ノード網 / 1=同心円 / 2=ドット格子 / 3=波線）。

## 8. GitHub Pages 以外でホスティングする場合
`Code.gs` の `commitToGitHub_()` を差し替えれば他環境にも対応可:
- **Netlify/Vercel**: リポジトリ更新に連動して再デプロイ（GitHub経由なら本コードのままでOK）。
- **Driveや任意サーバ**: `posts.json` をDriveに書き出し→Web公開、あるいはFTP/Storageへ送る関数に置換。
  その場合、`index.html` の `fetch("posts.json")` の参照先URLも合わせて調整。

## 9. 拡張のヒント（将来）
- 記事詳細ページ（`/notes/<id>.html`）を生成し、一覧からリンク。`body` をそこで表示。
- カテゴリ絞り込み、RSS出力、OGP画像（`art`モチーフを流用）自動生成。
- トピック枯渇時に `topics` を自動補充する関数を追加（ただし公開は必ず承認制のまま）。
