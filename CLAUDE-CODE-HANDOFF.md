# Claude Code ハンドオフ — ロゴ組み込み & リポジトリ化

このリポジトリを Claude Code で仕上げるための手順。`CLAUDE.md` のルールに従うこと。

---

## 0. リポジトリ初期化（初回のみ）
```bash
cd odenga-hp
git init
git add .
git commit -m "init: Odenga HP (notes/prompts pipeline, placeholder logo)"
# 既存のGitHubリポジトリに接続（例）
git remote add origin git@github.com:taco78sasa-odenga/odenga-hp.git
git branch -M main
git push -u origin main
```

## 1. Claude Code へ貼る指示（コピペ）
```
CLAUDE.md のルールに従い、ロゴを本番化して。手順:
1. dotfiles 内の会社ロゴを探す（*odenga*logo* / brand配下など）。見つけたパスを教えてから進めて。
2. そのロゴを assets/logo.svg（PNGなら assets/logo.png）としてコピー。
3. index.html の2箇所のプレースホルダSVGを <img> に置換（下の「差し替え内容」の通り）。nav側の twinkle は付けない。
4. ロゴの主色を確認し、:root の --rose(#E093A8) / --rose-deep(#B4566F) と競合しそうなら
   ロゴと調和するトーンへ微調整。白ベース・文字大きめ・ローズ控えめ・ink主役 は維持。
5. python3 -m http.server 8000 で表示確認。ノート/プロンプト/コピー動作/モバイル/コントラストAAをチェックし、
   スクショで自己レビュー。問題あれば直す。
6. 小さめのコミットに分けてコミット（例: "feat: integrate brand logo", "style: tune rose to match logo"）。
```

## 2. 差し替え内容（index.html）

### 2-1. ナビ（222行目あたり）
**before**
```html
      <!-- ▼ ロゴ差し替え箇所（下のSVGを本番ロゴ画像に置換） ▼ -->
      <svg class="logo-mark twinkle" viewBox="0 0 32 32" aria-hidden="true">
        <circle class="lm-o" cx="16" cy="16" r="12"/>
        <circle class="lm-core" cx="16" cy="16" r="3.4"/>
        <circle class="lm-node" cx="16" cy="4" r="2.6"/>
        <circle class="lm-node" cx="27" cy="22" r="2.6"/>
        <circle class="lm-node" cx="5" cy="22" r="2.6"/>
      </svg>
```
**after**
```html
      <img src="assets/logo.svg" class="logo-img" alt="オデンガ・テクノロジーズ">
```

### 2-2. フッター（470行目あたり）
**before**
```html
      <svg class="logo-mark" viewBox="0 0 32 32" aria-hidden="true">
        <circle class="lm-o" cx="16" cy="16" r="12"/>
        <circle class="lm-core" cx="16" cy="16" r="3.4"/>
        <circle class="lm-node" cx="16" cy="4" r="2.6"/>
        <circle class="lm-node" cx="27" cy="22" r="2.6"/>
        <circle class="lm-node" cx="5" cy="22" r="2.6"/>
      </svg>
```
**after**
```html
      <img src="assets/logo.svg" class="logo-img" alt="オデンガ・テクノロジーズ">
```

> `.logo-img { height:26px; width:auto }` は既に定義済み。ロゴの縦横比が極端なら height を 22〜30px で調整。
> ロゴが横長ワードマークの場合、brandテキスト「オデンガ・テクノロジーズ」と重複するなら、
> ロゴ側だけ表示して brandテキストを外す判断もあり（その場合は small の "ODENGA TECH" も見直し）。

## 3. デプロイ確認
- GitHub Pages（Settings > Pages）で `main` / `root` を公開。
- GAS 側スクリプトプロパティ `GITHUB_REPO` をこのリポジトリ名に設定 → 公開パイプライン接続。

## 4. 最終チェックリスト
- [ ] ロゴが nav / footer 両方で正しく表示
- [ ] twinkle は hero フロー図のノードだけ（ロゴは点滅しない）
- [ ] 白ベース・大きめ文字・ローズ控えめを維持、ロゴと色が喧嘩しない
- [ ] ローカルサーバでノート3件・プロンプト4件・コピー動作OK
- [ ] モバイル幅・キーボードフォーカス・reduced-motion 崩れなし
