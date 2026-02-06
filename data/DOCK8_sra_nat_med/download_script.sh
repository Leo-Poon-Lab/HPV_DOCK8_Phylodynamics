#!/bin/bash
# Enhanced SRA Download Script with Error Handling

# Configuration
MAX_JOBS=5                 # Simultaneous downloads
THREADS_PER_DOWNLOAD=8    # Threads per fasterq-dump
TIMEOUT_HOURS=2            # Max time per download
LOG_FILE="download.log"
FAILED_FILE="failed_srr.list"

# Initialize tracking arrays
declare -a SUCCESS_SRR
declare -a FAILED_SRR

# Clear previous logs
> "$LOG_FILE"

# Main download loop
awk -F',' 'NR>1 {print $1}' SraRunTable.csv | while read -r SRR_NUMBER; do

    # Throttle parallel jobs
    while [ $(jobs -r | wc -l) -ge $MAX_JOBS ]; do
        sleep 10
    done

    # Start download job in background
    (
        LOG_PREFIX="[SRR-${SRR_NUMBER}] $(date '+%Y-%m-%d %H:%M:%S')"
        echo "${LOG_PREFIX} STARTED" >> "$LOG_FILE"
        
        # Run with timeout and capture output
        timeout ${TIMEOUT_HOURS}h fasterq-dump --split-3 "$SRR_NUMBER" \
            --threads $THREADS_PER_DOWNLOAD \
            -o "$SRR_NUMBER" 2>&1 | 
            awk -v prefix="$LOG_PREFIX" '{print prefix " " $0}' >> "$LOG_FILE"
        
        EXIT_CODE=${PIPESTATUS[0]}
        
        # Verify successful completion
        if [ $EXIT_CODE -eq 0 ] && [ -s "${SRR_NUMBER}_1.fastq" ]; then
            echo "${LOG_PREFIX} COMPLETED SUCCESSFULLY" >> "$LOG_FILE"
            SUCCESS_SRR+=("$SRR_NUMBER")
        else
            echo "${LOG_PREFIX} FAILED WITH CODE $EXIT_CODE" >> "$LOG_FILE"
            FAILED_SRR+=("$SRR_NUMBER")
            # Clean incomplete files
            rm -f "${SRR_NUMBER}"*.fastq
        fi
    ) &
done

# Wait for remaining jobs
wait

# Generate final report
echo -e "\n=== Download Summary ===" | tee -a "$LOG_FILE"
echo "Successful: ${#SUCCESS_SRR[@]} SRRs" | tee -a "$LOG_FILE"
echo "Failed: ${#FAILED_SRR[@]} SRRs" | tee -a "$LOG_FILE"
printf '%s\n' "${FAILED_SRR[@]}" > "$FAILED_FILE"

# Additional verification
echo -e "\nRunning post-download checks..." | tee -a "$LOG_FILE"
for SRR in "${SUCCESS_SRR[@]}"; do
    if [ ! -f "${SRR}_1.fastq" ] || [ ! -f "${SRR}_2.fastq" ]; then
        echo "ERROR: ${SRR} missing paired files" | tee -a "$LOG_FILE"
        FAILED_SRR+=("$SRR")
    elif [ $(wc -l < "${SRR}_1.fastq") -ne $(wc -l < "${SRR}_2.fastq") ]; then
        echo "ERROR: ${SRR} read count mismatch" | tee -a "$LOG_FILE"
        FAILED_SRR+=("$SRR")
    fi
done

# Update failed list
printf '%s\n' "${FAILED_SRR[@]}" > "$FAILED_FILE"

echo -e "\nProcess completed. Failed SRRs saved to $FAILED_FILE" | tee -a "$LOG_FILE"