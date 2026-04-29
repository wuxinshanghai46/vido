#!/bin/bash
# 把 /opt/vido/app/outputs 从系统盘迁移到数据盘 /data/vido/outputs
# 全程日志打印，任一步失败即退出（set -e）
set -e

echo "═══════════════════════════════════════════"
echo "  VIDO 数据盘迁移脚本"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
echo "═══════════════════════════════════════════"

DEV=/dev/nvme1n1
MNT=/data
VIDO_ROOT=/opt/vido/app
SRC=$VIDO_ROOT/outputs
DST=$MNT/vido/outputs
BAK=$VIDO_ROOT/outputs.bak.$(date +%s)

# ── Step 1：探测数据盘
echo ""
echo "▶ Step 1/9: 探测数据盘"
if [ ! -b $DEV ]; then echo "✗ $DEV 不存在"; exit 1; fi
echo "  $DEV 大小:"
blockdev --getsize64 $DEV | awk '{printf "    %.1f GB\n", $1/1024/1024/1024}'

# 幂等：如果已有 ext4 文件系统就不再格式化
EXISTING_FS=$(blkid -o value -s TYPE $DEV 2>/dev/null || echo "")
if [ "$EXISTING_FS" = "ext4" ]; then
  echo "  ⚠ 已有 ext4 文件系统，跳过 mkfs"
else
  if [ -n "$EXISTING_FS" ]; then
    echo "  ✗ 已有文件系统类型 $EXISTING_FS，为安全起见不覆盖。手动处理后重跑"
    exit 1
  fi
  echo ""
  echo "▶ Step 2/9: mkfs.ext4 $DEV"
  mkfs.ext4 -F -L vido-data $DEV
fi

# ── Step 3：创建挂载点
echo ""
echo "▶ Step 3/9: 挂载点 $MNT"
mkdir -p $MNT
# 如果已挂载在 $MNT 且是 $DEV 就跳过
if mount | grep -q "^$DEV on $MNT"; then
  echo "  ⚠ 已挂载，跳过"
else
  mount $DEV $MNT
fi
df -hT $MNT | tail -1

# ── Step 4：fstab 持久化
echo ""
echo "▶ Step 4/9: /etc/fstab 写入持久化挂载"
UUID=$(blkid -s UUID -o value $DEV)
echo "  UUID=$UUID"
if grep -q "$UUID" /etc/fstab; then
  echo "  ⚠ /etc/fstab 已含此 UUID，跳过"
else
  # 备份 fstab
  cp /etc/fstab /etc/fstab.bak.$(date +%s)
  echo "UUID=$UUID $MNT ext4 defaults,noatime 0 2" >> /etc/fstab
  echo "  ✓ fstab 已追加"
fi
# 校验 fstab 语法
mount -a --fake 2>&1 && echo "  ✓ fstab 语法校验通过"

# ── Step 5：创建目标目录
echo ""
echo "▶ Step 5/9: 创建 $DST"
mkdir -p $DST

# ── Step 6：rsync 迁移（PM2 仍在运行，这一步无停机）
echo ""
echo "▶ Step 6/9: rsync $SRC/ → $DST/"
SRC_SIZE=$(du -sh $SRC 2>/dev/null | awk '{print $1}')
echo "  源大小: $SRC_SIZE"
rsync -a --info=progress2 --no-inc-recursive $SRC/ $DST/ 2>&1 | tail -5

# ── Step 7：停 PM2，做最终一次 rsync（保证增量同步）
echo ""
echo "▶ Step 7/9: 暂停 PM2 做最终同步"
pm2 stop vido
echo "  PM2 stopped"
rsync -a --delete $SRC/ $DST/
echo "  ✓ 最终 rsync 完成"

# ── Step 8：原 outputs 改名备份 + 建软链
echo ""
echo "▶ Step 8/9: 切换目录"
if [ -L $SRC ]; then
  echo "  $SRC 已是软链，删除"
  rm $SRC
else
  mv $SRC $BAK
  echo "  原 outputs → $BAK（保留备份）"
fi
ln -s $DST $SRC
ls -la $SRC
echo "  ✓ 软链完成: $SRC -> $DST"

# ── Step 9：重启 PM2 + 验证
echo ""
echo "▶ Step 9/9: 重启 PM2"
pm2 start vido
sleep 4
pm2 jlist | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d).find(x=>x.name==='vido');console.log('  status=',j.pm2_env.status,'restarts=',j.pm2_env.restart_time)})"
HTTP=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4600/api/health)
echo "  /api/health: $HTTP"
if [ "$HTTP" != "200" ]; then
  echo "  ⚠ 健康检查失败，保留备份不删"
  exit 1
fi

echo ""
echo "═══════════════════════════════════════════"
echo "  ✓ 迁移完成"
echo "  数据盘: $(df -h $MNT | tail -1 | awk '{print $3" used of "$2" ("$5")"}')"
echo "  系统盘: $(df -h / | tail -1 | awk '{print $3" used of "$2" ("$5")"}')"
echo "  备份保留在: $BAK（确认无问题后可手动删除：rm -rf $BAK）"
echo "═══════════════════════════════════════════"
