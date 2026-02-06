#!/bin/bash
# kneaddata_processor.sh

# Configuration
INPUT_DIR="/home/ubuntu/HPV_evo/DOCK8_sra"
OUTPUT_ROOT="/home/ubuntu/HPV_evo/kneaddata"
DB_PATH="/home/ubuntu/HPV_evo/human_ref/bowtie2-index"
THREADS=20
MASTER_LOG="${OUTPUT_ROOT}/kneaddata_master.log"
SUMMARY_CSV="${OUTPUT_ROOT}/processing_summary.csv"

# Initialize logging system
mkdir -p "${OUTPUT_ROOT}"
{
    echo "Kneaddata Batch Processing Log"
    echo "Started: $(date +"%Y-%m-%d %T")"
    echo "Input Directory: ${INPUT_DIR}"
    echo "Output Root: ${OUTPUT_ROOT}"
    echo "Database Path: ${DB_PATH}"
    echo "Threads per Sample: ${THREADS}"
    echo "----------------------------------------"
} > "${MASTER_LOG}"

# CSV Header
echo "SampleID,StartTime,EndTime,DurationSeconds,ExitStatus" > "${SUMMARY_CSV}"

# Process each sample sequentially
sample_count=0
success_count=0
fail_count=0

while IFS= read -r input_file; do
    sample_id=$(basename "${input_file}" _1.fastq)
    output_dir="${OUTPUT_ROOT}/${sample_id}"
    
    # Create sample directory
    mkdir -p "${output_dir}"
    
    # Record start time
    start_time=$(date +"%Y-%m-%d %T")
    start_epoch=$(date +%s)
    
    # Log to master file
    echo "[${start_time}] START processing ${sample_id}" | tee -a "${MASTER_LOG}"
    
    # Run kneaddata with error handling
    {
        echo "=== Processing Details ==="
        echo "Sample ID: ${sample_id}"
        echo "Input Files:"
        echo "  - ${input_file}"
        echo "  - ${input_file/_1.fastq/_2.fastq}"
        echo "Output Directory: ${output_dir}"
        echo "Database: ${DB_PATH}"
        echo "Threads: ${THREADS}"
        echo "Start Time: ${start_time}"
    } | tee -a "${MASTER_LOG}" "${output_dir}/sample_report.txt"

    # Capture exit status in main shell
    kneaddata \
        --input1 "${input_file}" \
        --input2 "${input_file/_1.fastq/_2.fastq}" \
        --output "${output_dir}" \
        -db "${DB_PATH}" \
        --threads "${THREADS}" 2>&1 | tee -a "${MASTER_LOG}" "${output_dir}/sample_report.txt"
    
    exit_status=${PIPESTATUS[0]}
    
    # Calculate processing time
    end_time=$(date +"%Y-%m-%d %T")
    end_epoch=$(date +%s)
    duration=$((end_epoch - start_epoch))
    
    # Update counters
    if [ ${exit_status} -eq 0 ]; then
        ((success_count++))
    else
        ((fail_count++))
    fi
    
    # Update CSV
    echo "${sample_id},${start_time},${end_time},${duration},${exit_status}" >> "${SUMMARY_CSV}"
    
    # Log completion
    {
        echo "[${end_time}] END processing ${sample_id}"
        echo "Exit Status: ${exit_status}"
        echo "Duration: ${duration} seconds"
        echo "----------------------------------------"
    } | tee -a "${MASTER_LOG}" "${output_dir}/sample_report.txt"
    
    ((sample_count++))
    
done < <(find "${INPUT_DIR}" -name "*_1.fastq" | sort)

# Final summary
{
    echo -e "\nBatch Processing Completed: $(date +"%Y-%m-%d %T")"
    echo "Total Samples Processed: ${sample_count}"
    echo "Successfully Processed: ${success_count}"
    echo "Failed: ${fail_count}"
    echo -e "\nSummary CSV: ${SUMMARY_CSV}"
    echo "Sample reports: ${OUTPUT_ROOT}/<SAMPLE_ID>/sample_report.txt"
} | tee -a "${MASTER_LOG}"

# Display final message
echo -e "\nProcessing complete! Master log: ${MASTER_LOG}"
echo "CSV summary: ${SUMMARY_CSV}"