#!/bin/bash

# Path to the mapping CSV
MAPPING_CSV="/home/ubuntu/HPV_evo/kneaddata/SRR_MET.csv"

# Base directory containing SRR folders
BASE_DIR="/home/ubuntu/HPV_evo/kneaddata"

# Create merged directory if it doesn't exist
mkdir -p "${BASE_DIR}/merged"

# Create an associative array to map MET to SRRs
declare -A MET_SRR_MAP

# Read the mapping CSV and populate the array
while IFS=, read -r SRR MET
do
    # Skip header line
    if [ "$SRR" != "SRR" ]; then
        MET_SRR_MAP["$MET"]+="$SRR "
    fi
done < "$MAPPING_CSV"

# Process each MET sample
for MET in "${!MET_SRR_MAP[@]}"
do
    echo "Processing sample: $MET"
    
    # Initialize output files in merged directory
    output_1="${BASE_DIR}/merged/${MET}_kneaddata_paired_1.fastq"
    output_2="${BASE_DIR}/merged/${MET}_kneaddata_paired_2.fastq"
    
    # Remove existing files if they exist
    rm -f "$output_1" "$output_2"
    
    # Split the SRR list into array
    read -ra SRRS <<< "${MET_SRR_MAP[$MET]}"
    
    # Process each SRR for this MET
    for SRR in "${SRRS[@]}"
    do
        # Define paths to input files
        srrdir="${BASE_DIR}/${SRR}"
        file1="${srrdir}/${SRR}_1_kneaddata_paired_1.fastq"
        file2="${srrdir}/${SRR}_1_kneaddata_paired_2.fastq"
        
        # Check if files exist before concatenating
        if [[ -f "$file1" && -f "$file2" ]]; then
            cat "$file1" >> "$output_1"
            cat "$file2" >> "$output_2"
            echo "  Added $SRR"
        else
            echo "  WARNING: Missing files for $SRR!"
        fi
    done
    
    echo "Created merged files:"
    echo "  Forward: $output_1"
    echo "  Reverse: $output_2"
    echo
done
