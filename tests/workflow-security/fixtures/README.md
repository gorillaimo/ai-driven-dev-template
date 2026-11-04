# 検査用fixture

osv-advisory.jsonはOSV-Scanner 2.7.0の[公式offline test fixture](https://github.com/google/osv-scanner/blob/v2.7.0/cmd/osv-scanner/internal/testcmd/testdata/offline-dbs/npm/GHSA-whgm-jr23-g3j9.json)から取得した公開advisoryの固定例です。上流repositoryはApache-2.0です。元のadvisoryは[GitHub Advisory Database](https://github.com/github/advisory-database/tree/main/advisories/github-reviewed/2021/09/GHSA-whgm-jr23-g3j9)に由来します。

live.mjsはこの限定fixtureだけを入れたDBと、既知の安全版/影響版を記した合成lockfileを一時領域に作ります。現在の公開DBを取得した証拠や、実アプリ全体の安全確認には使いません。実scannerでの検出/非検出を確認するための試験です。lockfileにはregistryのresolved情報を持たせ、LOCAL依存と取り違えないようにしています。

secret用文字列や危険なcode/IaCは実試行の一時directoryに生成します。有効なcredentialや実serviceへの攻撃は含みません。
