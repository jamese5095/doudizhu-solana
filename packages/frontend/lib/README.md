# lib/idl.json — 注意事项

此文件是 `programs/doudizhu/target/idl/programs_doudizhu.json` 的**手动副本**。

每次合约重新部署后必须同步更新，否则前端调用会因 IDL 不匹配报错。

更新命令（从仓库根目录执行）：

```bash
cp programs/doudizhu/target/idl/programs_doudizhu.json packages/frontend/lib/idl.json
```
