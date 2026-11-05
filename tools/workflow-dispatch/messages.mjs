export const messages = Object.freeze({
  passed:
    "検査に適合しました。実行権限の付与や実環境での動作確認は含みません。",
  blocked: "確認が必要なため停止しました。診断コードを確認してください。",
  ready:
    "台帳の記録は再開可能な状態です。起動には現在の承認と権限の確認が必要です。",
  recovery_required: "未解消の作業があります。停止と外部更新の照合が必要です。",
  unmigrated: "明示的な移行が完了していません。",
  input_invalid: "入力または引数を確認してください。",
});
