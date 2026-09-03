GitHub Pages公開用の設定を追加してください。

現在の状態：
- GitHubリポジトリ：onochin/Web-GisTool
- GitHub PagesのSourceは「GitHub Actions」に設定済み
- vite.config.ts の base は、GitHub Pages用に /Web-GisTool/ へ修正済み

対応内容：
- .github/workflows/deploy.yml を作成
- mainブランチへのpush時に自動ビルド・自動デプロイ
- GitHub Pages用buildでは
  npm run build -- --mode github-pages
  を使用
- dist をGitHub Pagesへデプロイ
- 既存アプリ機能は変更しない
- React Routerを使っている場合、GitHub Pages上でのルーティングに問題がないか確認

作業後に以下を確認してください。
1. lint
2. 型チェック
3. テスト
4. npm run build -- --mode github-pages

最後に変更内容と確認結果を簡潔に報告してください。
