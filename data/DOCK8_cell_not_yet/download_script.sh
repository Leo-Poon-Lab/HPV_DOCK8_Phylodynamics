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

# Clear previous logs and failed list
> "$LOG_FILE"
> "$FAILED_FILE"

# Main download loop
# Reads the first column (SRA numbers) from biosample_result.csv, skipping the header.
awk -F',' 'NR>1 {print $1}' biosample_result.csv | while read -r SRR_NUMBER; do

    # Check for empty SRR_NUMBER
    if [ -z "$SRR_NUMBER" ]; then
        continue
    fi

    # Throttle parallel jobs
    while [ $(jobs -r | wc -l) -ge $MAX_JOBS ]; do
        sleep 10
    done

    # Start download job in background
    (
        LOG_PREFIX="[${SRR_NUMBER}] $(date '+%Y-%m-%d %H:%M:%S')"
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
            # Using a temporary file for concurrent-safe appends
            echo "$SRR_NUMBER" >> success.tmp
        else
            echo "${LOG_PREFIX} FAILED WITH CODE $EXIT_CODE" >> "$LOG_FILE"
            echo "$SRR_NUMBER" >> "$FAILED_FILE"
            # Clean incomplete files
            rm -f "${SRR_NUMBER}"*.fastq
        fi
    ) &
done

# Wait for remaining jobs
wait

# Populate success array from temp file
if [ -f "success.tmp" ]; then
    mapfile -t SUCCESS_SRR < success.tmp
    rm success.tmp
fi

# Populate failed array from final failed list
if [ -f "$FAILED_FILE" ]; then
    mapfile -t FAILED_SRR < "$FAILED_FILE"
fi


# Generate final report
echo -e "\n=== Download Summary ===" | tee -a "$LOG_FILE"
echo "Successful: ${#SUCCESS_SRR[@]} SRRs" | tee -a "$LOG_FILE"
echo "Failed: ${#FAILED_SRR[@]} SRRs" | tee -a "$LOG_FILE"

# Additional verification for successfully downloaded files
if [ ${#SUCCESS_SRR[@]} -gt 0 ]; then
    echo -e "\nRunning post-download checks..." | tee -a "$LOG_FILE"
    
    # Create a new array for files that pass the check
    declare -a VERIFIED_SUCCESS_SRR
    
    for SRR in "${SUCCESS_SRR[@]}"; do
        VALID=true
        if [ ! -f "${SRR}_1.fastq" ] || [ ! -s "${SRR}_1.fastq" ] || [ ! -f "${SRR}_2.fastq" ] || [ ! -s "${SRR}_2.fastq" ]; then
            echo "ERROR: ${SRR} is missing one or both paired-end files, or files are empty." | tee -a "$LOG_FILE"
            echo "$SRR" >> "$FAILED_FILE"
            VALID=false
        elif [ $(wc -l < "${SRR}_1.fastq") -ne $(wc -l < "${SRR}_2.fastq") ]; then
            echo "ERROR: ${SRR} paired-end files have a read count mismatch." | tee -a "$LOG_FILE"
            echo "$SRR" >> "$FAILED_FILE"
            VALID=false
        fi

        if [ "$VALID" = true ]; then
            VERIFIED_SUCCESS_SRR+=("$SRR")
        fi
    done
fi

# Final cleanup of failed list
sort -u "$FAILED_FILE" -o "$FAILED_FILE"

echo -e "\nProcess completed. Check $LOG_FILE for details."
echo "A final list of failed SRRs has been saved to $FAILED_FILE"