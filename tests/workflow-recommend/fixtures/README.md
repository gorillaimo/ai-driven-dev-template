# 次作業推薦の合成入力

example/project・example-user・Issue #1は検証用です。実案件の担当・証拠や承認を表しません。
未割当のlegacy Issueについて、確認済み契約からCoordinatorへの割当相談を返します。
paths.jsonをloadProjectRecommendationへ渡す例は[運用マニュアル](../../../docs/common/operations-manual.md)にあります。

実案件では台帳・GitHub観測・人間とagentへの依頼・権限・全量claim・根拠・時刻を確認して置き換え、canonical digestを再計算してください。
managed Issueはaggregate.workflowsに既存checkerの元plan/state/context/ruleInputと必要なprevious/revisionPlansを明示します。
今回の合成テストはProject全体Goldenや実GitHub運用の保証ではありません。
