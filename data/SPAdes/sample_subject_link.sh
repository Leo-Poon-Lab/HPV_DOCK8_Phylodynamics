#!/bin/bash

# Define file paths and directories
CSV_FILE="sample_subject_links_focus.csv"
SOURCE_BASE_DIR="/home/ubuntu/HPV_evo/spades"
DEST_BASE_DIR="/home/ubuntu/HPV_evo/spades_contigs"

# 1. Create the main destination directory
echo "🚀 Starting the process..."
echo "Creating base directory: $DEST_BASE_DIR"
mkdir -p "$DEST_BASE_DIR"

# Check if the CSV file exists before proceeding
if [ ! -f "$CSV_FILE" ]; then
    echo "❌ Error: CSV file not found at '$CSV_FILE'. Please ensure the file is in the current directory."
    exit 1
fi

# 2. & 3. Read the CSV and process each sample
# Use tail to skip the header row, then read each line
tail -n +2 "$CSV_FILE" | while IFS=, read -r tube_label library_id seq_type subject_id site_specific date_collected group_id habitat site_extended seq_platform
do
    # This script will now attempt to process all rows from the CSV.
    
    # Convert tube_label to uppercase to match directory names like 'MET1786_SPAdes_output'
    upper_tube_label=$(echo "$tube_label" | tr 'a-z' 'A-Z')

    # Define the full path for the source file
    source_file="$SOURCE_BASE_DIR/${upper_tube_label}_SPAdes_output/contigs.fasta"

    # Define the destination directory for the subject
    # Use default values if fields are empty to prevent errors
    dest_dir="$DEST_BASE_DIR/${group_id:-unknown_group}_${subject_id:-unknown_subject}"

    # Define the new, renamed file
    new_filename="${site_specific:-unknown_site}_${tube_label}_contigs.fasta"

    # Check if the source contigs.fasta file actually exists
    if [ -f "$source_file" ]; then
        # Create the subject-specific directory if it doesn't already exist
        mkdir -p "$dest_dir"

        # Copy the file to the new location with its new name
        cp "$source_file" "$dest_dir/$new_filename"
        echo "✅ Copied: $tube_label -> ${group_id}_${subject_id}/$new_filename"
    else
        # Print a warning if a source file can't be found
        echo "⚠️  Warning: Source file not found, skipping: $source_file"
    fi
done

echo "🎉 All done! Files have been organized in $DEST_BASE_DIR"