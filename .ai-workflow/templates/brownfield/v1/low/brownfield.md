# Brownfield調査メモ

合成の記入例です。実プロジェクトの調査結果・承認ではありません。

構造化された正本は [brownfield.yaml](brownfield.yaml) です。
Issue関連領域と隣接依存に絞る例です。調査上限に達した範囲を残します。

基準commitとIssue更新時刻はYAMLの`extensions.brownfield_review.baseline`、
調査目的・上限・停止条件・承認は同`brownfield_review`を確認してください。
対象は`scope`、除外は`constraints / prohibited_areas`です。

未確認事項は`unknowns`、合意scope内の未解析は`unanalysed`、
リスクと次の作業は`risks / follow_up`に残します。
YAMLと矛盾する記述があればIssueへ差分を示し、勝手に完了へ変更しません。

`commands`は資料で見つけた記録です。起動・build・test・deployや依存導入を実行しません。
改善候補・文書更新案は提案だけで、この調査から実装や採用構成の変更へ進みません。

使い方と承認後の調査項目は [Brownfield解析ガイド](../../../../../docs/common/brownfield-analysis-guide.md) を参照してください。
