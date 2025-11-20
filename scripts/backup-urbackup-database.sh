#!/bin/bash
# UrBackup Database Backup Script
# Run this script on the UrBackup server (192.168.22.251) as root

BACKUP_DIR="/var/urbackup"
BACKUP_DEST="/root/urbackup-db-backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_NAME="urbackup-db-backup-${TIMESTAMP}"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}========================================${NC}"
echo -e "${YELLOW}UrBackup Database Backup${NC}"
echo -e "${YELLOW}========================================${NC}"
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then
   echo -e "${RED}ERROR: Please run as root${NC}"
   exit 1
fi

# Create backup directory
mkdir -p "${BACKUP_DEST}"

echo -e "${YELLOW}[1/6] Stopping UrBackup Server...${NC}"
systemctl stop urbackupsrv
if [ $? -ne 0 ]; then
    echo -e "${RED}ERROR: Failed to stop UrBackup server${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Server stopped${NC}"

echo ""
echo -e "${YELLOW}[2/6] Creating backup directory...${NC}"
mkdir -p "${BACKUP_DEST}/${BACKUP_NAME}"
echo -e "${GREEN}✓ Directory created: ${BACKUP_DEST}/${BACKUP_NAME}${NC}"

echo ""
echo -e "${YELLOW}[3/6] Copying database files...${NC}"
declare -a DB_FILES=(
    "backup_server.db"
    "backup_server_settings.db"
    "backup_server_files.db"
    "backup_server_links.db"
    "backup_server_link_journal.db"
)

for db_file in "${DB_FILES[@]}"; do
    if [ -f "${BACKUP_DIR}/${db_file}" ]; then
        cp -v "${BACKUP_DIR}/${db_file}" "${BACKUP_DEST}/${BACKUP_NAME}/"
        if [ $? -eq 0 ]; then
            size=$(du -h "${BACKUP_DIR}/${db_file}" | cut -f1)
            echo -e "${GREEN}  ✓ ${db_file} (${size})${NC}"
        else
            echo -e "${RED}  ✗ Failed to copy ${db_file}${NC}"
        fi
    else
        echo -e "${YELLOW}  ⚠ ${db_file} not found (may not exist yet)${NC}"
    fi
done

echo ""
echo -e "${YELLOW}[4/6] Creating compressed archive...${NC}"
cd "${BACKUP_DEST}"
tar -czf "${BACKUP_NAME}.tar.gz" "${BACKUP_NAME}"
if [ $? -eq 0 ]; then
    backup_size=$(du -h "${BACKUP_NAME}.tar.gz" | cut -f1)
    echo -e "${GREEN}✓ Archive created: ${backup_size}${NC}"
    rm -rf "${BACKUP_NAME}"
else
    echo -e "${RED}ERROR: Failed to create archive${NC}"
    systemctl start urbackupsrv
    exit 1
fi

echo ""
echo -e "${YELLOW}[5/6] Starting UrBackup Server...${NC}"
systemctl start urbackupsrv
if [ $? -ne 0 ]; then
    echo -e "${RED}ERROR: Failed to start UrBackup server${NC}"
    exit 1
fi
sleep 2
echo -e "${GREEN}✓ Server started${NC}"

echo ""
echo -e "${YELLOW}[6/6] Verifying server status...${NC}"
systemctl is-active --quiet urbackupsrv
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Server is running${NC}"
else
    echo -e "${RED}✗ Server is not running!${NC}"
fi

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}BACKUP COMPLETE${NC}"
echo -e "${GREEN}========================================${NC}"
echo -e "Backup location: ${BACKUP_DEST}/${BACKUP_NAME}.tar.gz"
echo -e "Backup size: ${backup_size}"
echo -e "Timestamp: ${TIMESTAMP}"
echo ""
echo -e "${YELLOW}Keep at least 3 recent backups!${NC}"
echo ""
echo -e "To restore from this backup:"
echo -e "  1. Stop server: systemctl stop urbackupsrv"
echo -e "  2. Remove old databases from ${BACKUP_DIR}"
echo -e "  3. Extract: tar -xzf ${BACKUP_NAME}.tar.gz"
echo -e "  4. Copy files: cp ${BACKUP_NAME}/*.db ${BACKUP_DIR}/"
echo -e "  5. Start server: systemctl start urbackupsrv"
echo ""

# List recent backups
echo -e "${YELLOW}Recent backups:${NC}"
ls -lht "${BACKUP_DEST}"/*.tar.gz 2>/dev/null | head -5 | awk '{print "  " $9 " (" $5 ")"}'

exit 0
