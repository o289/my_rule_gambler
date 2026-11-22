# CI/CD 詳細設計

## ファイルの分割

- StagingとProductionのCI/CDファイルを分ける。
- Staging用は`.github/workflows/staging.yml`、Production用は`.github/workflows/production.yml`とする。
- この文書はファイルの役割を定義する。現時点では実際のworkflowファイルは作成していない。

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

## 動作確認

- `main`の直接プッシュとPRマージでStagingが自動更新され、Productionは更新されないことを確認する。
- Productionはユーザーによる手動実行時のみ更新されることを確認する。
- `STG`の変数・秘匿情報・Worker・DO・SFU Appが`PROD`と混ざらないことを確認する。
- 検査に失敗した対象コードがデプロイされないことを確認する。
