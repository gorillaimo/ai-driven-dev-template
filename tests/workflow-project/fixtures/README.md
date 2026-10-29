# Project plan checkerの合成snapshot

project.yaml、delivery-plan.json、context.jsonは同じ合成projectの初期計画です。
単一feature a、revision 1、固定時刻、人間example-userという記入例で、実案件の状態・権限・承認を示しません。
projectのtemplate_originのゼロcommit、login、参照、設定は実案件へ置換してください。

contextのdigestはコメントを除いたproject/planデータのcanonical SHA-256です。
GitHub等から事実を取得する仕組みではありません。digestを合わせるだけで作業を承認できません。
source_refのdocs/system-context.mdは公開元に存在せず、checkerも参照実在を未評価として返します。
コピー後の形式適合を、feature完了・member/owner適合・着手可能性の証拠にしないでください。

他の正常/異常/改訂fixtureはhelpersと各test内でこの合成設定から構築します。
最大graphはlarge.mjsの1000feature/10000edge。通信/commandを禁止したcold子processでも検査します。
fixturesは自動実行hookやcommand、実credential、共有Project stateを含みません。
