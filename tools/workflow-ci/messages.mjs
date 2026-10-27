export const messages=Object.freeze({
 pass:'ワークフロー成果物の形式・参照検査が終了しました。',blocked:'ワークフロー成果物の検査を停止しました。',
 schema_invalid:'成果物の形式またはversionが不正です。',yaml_invalid:'YAMLの構文または安全条件が不正です。',
 identity_mismatch:'directoryまたは成果物間の識別子が一致しません。',reference_missing:'必要な参照先がありません。',
 reference_invalid:'参照先を安全に検査できません。',unsafe_path:'通常ファイル・directory以外または不正なpathです。',
 future_reference:'将来または未採用の成果物は未評価です。',external_reference:'外部URLと本人性は未評価です。',
 fragment_not_evaluated:'未対応のfragmentは未評価です。',id_not_evaluated:'IDの名前空間を確定できないため未評価です。',
 trace_invalid:'traceのIDまたはリンクが不整合です。',size_limit:'入力のサイズまたは件数の上限を超えました。',
 inspection_failed:'検査を完了できませんでした。',output_limit:'結果のサイズ上限を超えました。',arguments_invalid:'指定できる引数は--jsonのみです。',
});
