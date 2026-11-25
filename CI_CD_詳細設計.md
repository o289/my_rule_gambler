# CI/CD 詳細設計

## ファイルの分割

- StagingとProductionのCI/CDファイルを分ける。
- STGの自動検査・配備は`.github/workflows/staging.yml`、手動巻き戻しは`.github/workflows/stg-rollback.yml`で行う。
- Production用は`.github/workflows/production.yml`を想定するが、この運用手順では作成・変更しない。

## 起動条件

| 対象 | 起動条件 | 実行者 |
| --- | --- | --- |
| Staging | `main`へのプッシュ。PRのマージによる`main`更新も含む | GitHub Actionsが自動実行 |
| Production | ユーザーによる手動実行 | ユーザー |

- Stagingでは対象コードのLint・型検査・Unit Test・Buildを確認し、失敗した場合はデプロイしない。
- Productionは`main`へのプッシュ・マージでは起動しない。手動実行時も対象コードの検査に失敗した場合はデプロイしない。
- Production用workflowの手動起動方式と反映対象コミットの指定方法は実装前に決める。

## 環境と秘匿情報

| 項目 | Staging | Production |
| --- | --- | --- |
| GitHub Environment | `STG` | `PROD` |
| 通常の環境変数 | `STG`のVariables | `PROD`のVariables |
| 秘匿情報 | `STG`のSecrets | `PROD`のSecrets |
| Worker | STG専用 | PROD専用 |
| Durable Objects保存領域 | STG専用 | PROD専用 |
| SFU App | STG専用 | PROD専用 |

- 各workflowは対象のGitHub Environmentを参照し、その環境の値を使用する。
- APIトークン、SFUのApp ID・App Secretを、対象環境のWorker・SFU Appに対応付ける。
- 通常変数と秘匿情報の管理先は決定済みだが、GitHub Environmentの値をWorker実行時の設定へ反映する具体手順は未確定。

## 公開と移行の未確定事項

- Stagingで検証したGitコミットと同じコミットをProductionへ反映する従来方針は維持するが、必須条件にするかどうかと検証方法は未確定。
- 手動Production反映で対象SHAをどう指定・記録するか、同時デプロイや古い実行の扱いは未確定。
- Durable Objectsのストレージ構造を変更する場合は、Production反映前にマイグレーションの互換性を確認する。
- 保存状態・同期プロトコルのバージョン、進行中/ポーズ中ルームの移行、失敗時の復旧手順は未確定。
- GitHub Environment・手動起動・必要な承認に利用できる機能は、リポジトリ公開範囲と契約に合わせて確認する。

## STG配備履歴と巻き戻し

- `staging.yml`は検査後にSTG Workerを配備し、版のメッセージにGit commit SHAを記録する。完了サマリーにはcommit SHA、Cloudflareのdeployment ID、版ID、GitHub Actions実行URLを記録する。`deployments status --json`で単一版が100%になったことを確認し、STGホストのHTTPSも確認する。
- 失敗した配備の復旧は、GitHub Actionsで`Roll back STG Worker`を`main`から手動実行し、`version_id`に直前の成功した単独100%配備の版ID、`expected_current_version_id`に現在配信中の版IDを入力する。workflowは両方のUUID形式、現在版が入力時から変わっていないこと、対象が履歴上の直前100%配備であることを確認してから`STG`環境の資格情報で巻き戻す。直前版以外は受け付けず、保存形式と合わない古いWorkerを選ぶ危険を減らす。
- 終了後は新しいdeployment ID、巻き戻し後の版ID、巻き戻し前の版IDが記録され、指定版が100%で有効になり、`STG_HOSTNAME`のHTTPS応答が成功したことを確認する。画面を再読み込みし、進行中の部屋は同じIDで再接続できるか確認する。以前の版へ戻す場合も同じ手動workflowを使い、巻き戻し後の履歴で現在版を確認する。通常配備・巻き戻しは`stg-worker`の共通排他グループで同時実行しない。
- WorkersのrollbackはWorkerの版と配備先を戻す操作で、Durable ObjectのSQLiteデータやマイグレーション状態は戻さない。現在と直前のSTG版は`RoomSnapshot` v1を共有する。データに未知の版番号や壊れた値があれば、Roomは初期化して上書きせず503で停止し、元データを保つ。スナップショットがまだ無い旧形式の部屋情報は、新しい空Roomとして読み込む。保存形式を変える場合は、少なくとも直前版が読める移行期間と、巻き戻し対象を先に確認する。
- Workerには受信メッセージや再接続tokenを記録する独自ログを追加しない。tokenは個人向けwelcomeとWebSocket本文だけで扱い、URLやログへ出さない。Cloudflareの標準Invocation Logsは運用確認に使い、アプリ独自ログが必要になったときはイベント種別・結果・時間などの許可した項目だけを構造化して記録する。ロールバック直後に古いタブのアセットが混在する場合はページを再読み込みする。Durable Objectのクラスや保存領域に変更があった版は、互換性を確認せずに対象にしない。
- 参考：[Workersの版と配備](https://developers.cloudflare.com/workers/versions-and-deployments/)、[ロールバック](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)、[Wranglerの配備履歴コマンド](https://developers.cloudflare.com/workers/wrangler/commands/workers/)、[Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)。

## 動作確認

- `main`の直接プッシュとPRマージでStagingが自動更新され、Productionは更新されないことを確認する。
- Productionはユーザーによる手動実行時のみ更新されることを確認する。
- `STG`の変数・秘匿情報・Worker・DO・SFU Appが`PROD`と混ざらないことを確認する。
- 検査に失敗した対象コードがデプロイされないことを確認する。
