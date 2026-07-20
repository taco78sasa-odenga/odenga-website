# オデンガ・テクノロジーズ コーポレートサイト

現場を知るITコンサルタントのHP。単一HTML＋データ（`posts.json`）構成、GitHub Pages配信。
ノート/プロンプトは GAS が半自動更新（下書き→承認→公開）。

## 構成
```
odenga-hp/
├─ index.html                 # サイト本体（CSS/JS内蔵）
├─ posts.json                 # ノート/プロンプトのデータ（GASが自動更新・手編集しない）
├─ assets/
│   └─ logo.svg               # 会社ロゴ（dotfilesから配置）
├─ automation/
│   ├─ Code.gs                # GAS（ソース管理用コピー）
│   └─ BLOG-PIPELINE.md       # 自動化パイプラインの手順
├─ DESIGN.md                  # デザイン仕様（トークン/原則）
├─ CLAUDE.md                  # Claude Code 用プロジェクトルール
└─ .gitignore
```

## クイックスタート
```bash
git clone <repo> && cd odenga-hp
python3 -m http.server 8000       # http://localhost:8000 で本番同等に確認
```
> `file://` 直開きは fetch がブロックされ SEED 表示になるため、必ずローカルサーバ経由で確認。

## デプロイ
GitHub Pages（Settings > Pages）で `main` / `root` を公開。

## 運用（週1本）
- **ノート**：`topics` に題材 → 毎週月 `generateDraft()` → シートで `approved` → `publishApproved()`。
- **プロンプト**：`prompt_inbox` に実プロンプトを貼る → 毎週木 `generatePromptDraft()` → 承認 → 公開。
- 詳細は [`automation/BLOG-PIPELINE.md`](automation/BLOG-PIPELINE.md)。
- **原則**：AIは下書き/整形まで。公開は必ず人の承認を挟む（E-E-A-T・scaled content abuse回避）。

## Claude Code キックオフ（コピペ用）
新規に Claude Code で整えるとき、以下を貼って指示できます（パスは環境に合わせて）。

```
このリポジトリを odenga-hp として整備して。CLAUDE.md のルールに従うこと。
1. 受け取った index.html / posts.json / DESIGN.md をルートに、Code.gs と BLOG-PIPELINE.md を automation/ に配置。
2. dotfiles のロゴ（例: ~/dotfiles/brand/odenga-logo.svg ← 実パスを確認して）を assets/logo.svg にコピー。
3. index.html の「ロゴ差し替え箇所」2箇所を <img src="assets/logo.svg" class="logo-img" alt="オデンガ・テクノロジーズ"> に置換。nav 側の twinkle は外す。
4. ロゴ主色に合わせ :root の --rose / --rose-deep が競合しないか確認し、必要なら微調整（白ベース・大きめ文字・ローズ控えめは維持）。
5. python3 -m http.server で表示確認（ノート/プロンプト/コピー動作/モバイル/コントラスト）。スクショで自己レビュー。
6. GitHub Pages を有効化。GAS 側のスクリプトプロパティ GITHUB_REPO をこのリポジトリに設定。
7. 変更は小さめのコミットに分け、意図を1行で。
```
