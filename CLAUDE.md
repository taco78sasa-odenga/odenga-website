# CLAUDE.md — オデンガ・テクノロジーズ コーポレートサイト

Claude Code がこのリポジトリで作業するときのルール。作業前に必ず読むこと。

## プロジェクト概要
個人事業「オデンガ・テクノロジーズ」のHP。単一HTML（`index.html`）＋データ（`posts.json`）構成。
GitHub Pages で配信。ノート/プロンプトは GAS（`automation/`）が半自動更新する。

## 構成と責務
| パス | 役割 | 誰が触る |
|---|---|---|
| `index.html` | サイト本体（CSS/JS内蔵） | 人＋Claude Code |
| `assets/` | ロゴ・画像 | 人＋Claude Code |
| `posts.json` | ノート/プロンプトのデータ | **GAS専用（手編集しない）** |
| `automation/Code.gs` | GASソース管理用コピー | 人＋Claude Code（実体はApps Script側） |
| `automation/BLOG-PIPELINE.md` | 運用手順 | 人 |
| `DESIGN.md` | デザイン仕様（トークン/原則） | 人＋Claude Code |

## 厳守ルール
1. **`posts.json` を手で書き換えない**。内容更新はスプレッドシート→GAS経由。人はコード側のみ。
2. **機密顧客名を載せない**（ICS/SCGM/入江 等）。実績は業種カテゴリで記述。
3. **デザイントークンを守る**（`DESIGN.md`）：白ベース / 文字大きめ(base 19px) / ローズは控えめ /
   ink主役 / モノ書体ラベル / ヘアライン構造。新しい色や影を勝手に足さない。
4. **変更後は必ずローカルでレンダリング確認**（下記）。コントラストAA・reduced-motion・モバイルを崩さない。
5. コミットは小さく。デザイン変更は差分の意図を1行で書く。

## ローカル確認
```bash
python3 -m http.server 8000    # → http://localhost:8000 で posts.json も含め本番同等に確認
```
（`file://` 直開きだと fetch がブロックされ SEED 表示になる。必ずローカルサーバ経由で見る）

## ロゴ組み込み手順
1. dotfiles のロゴを `assets/logo.svg`（または `.png`）として配置。
2. `index.html` 内の `<!-- ロゴ差し替え箇所 -->` 2箇所（nav / footer）の `<svg class="logo-mark ...">…</svg>` を
   `<img src="assets/logo.svg" class="logo-img" alt="オデンガ・テクノロジーズ">` に置換。
   - nav 側の `twinkle` は付けない（実ロゴが点滅すると煩い）。瞬きは hero フロー図のノードだけに残す。
3. ロゴの主色が強い場合、`:root` の `--rose` / `--rose-deep` をロゴと競合しないトーンに微調整。

## デプロイ
GitHub Pages（Settings > Pages）で `main` / `root` を公開。`index.html` はルート直下。

## 日常運用（コードではなくシート側）
- ノート：`topics` に題材、週1で `generateDraft()` → 承認 → 公開。
- プロンプト：`prompt_inbox` に実プロンプトを貼る → `generatePromptDraft()` → 承認 → 公開。
- 詳細は `automation/BLOG-PIPELINE.md`。
