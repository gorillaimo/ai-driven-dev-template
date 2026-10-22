// Stable codes are the interface; consumers may translate these descriptions.
export const messages = Object.freeze({
 invalid_rule:'ルールの形式が不正です。', invalid_context:'適用contextの形式が不正です。',
 invalid_opt_in:'opt-inの採用承認参照が不正です。', duplicate_rule:'ルールIDが重複しています。',
 unknown_rule:'参照するルールが存在しません。', unknown_condition:'適用条件の事実が不明です。',
 dependency_version:'固定versionが一致しません。', dependency_not_selected:'必須依存が選択されていません。',
 rule_conflict:'適用候補のルールが競合しています。', cycle:'宣言グラフに循環があります。',
 legacy_required:'必須のlegacyルールと2つの原文参照が必要です。', invalid_sources:'入力ファイルのdigestが不正です。',
});
