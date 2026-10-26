export const messages = Object.freeze({
 trace_pass:'No structural finding',
 schema_invalid:'入力形式が不正です。', identity_mismatch:'契約・作業・改訂が一致しません。',
 workflow_invalid:'現在の計画・履歴を確認できません。', inventory_mismatch:'正本台帳と対応表が一致しません。',
 duplicate_node:'node IDが重複しています。', duplicate_link:'リンクが重複しています。',
 unknown_endpoint:'リンク先が存在しません。', self_link:'自己参照リンクです。', invalid_relation:'型または方向が不正です。',
 orphan_node:'対応のない成果物です。', coverage_missing:'必要な対応経路がありません。', node_incomplete:'必要な成果物が未完了です。',
 non_scope_violation:'対象外の作業が含まれています。', approval_invalid:'対象に有効な承認参照がありません。',
 validation_invalid:'当該改訂の成功検証と一致しません。', reference_missing:'必要な参照を確認できません。',
 reference_invalid:'参照結果が不正です。', suppression_invalid:'抑制の期限・対象・承認・入力が不正です。',
 follow_up_missing:'未決事項・残課題の引き継ぎがありません。', stage_incomplete:'必要な工程が完了していません。',
});
