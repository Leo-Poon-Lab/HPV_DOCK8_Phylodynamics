#!/bin/bash

cd /home/ubuntu/HPV_evo/kneaddata/merged

# Define the output directory
output_base="/home/ubuntu/HPV_evo/spades"

for r1 in *_kneaddata_paired_1.fastq; do
  sample="${r1%_kneaddata_paired_1.fastq}"
  r2="${sample}_kneaddata_paired_2.fastq"

  if [[ -f "$r2" ]]; then
    echo "Processing metagenomic sample: $sample"
    
    # Run SPAdes and save output to the new location
    /home/ubuntu/tool/SPAdes-4.2.0-Linux/bin/spades.py --meta \
      -1 "$r1" \
      -2 "$r2" \
      -o "${output_base}/${sample}_SPAdes_output" \
      -t 20
    
    echo "Finished $sample"
  else
    echo "ERROR: Read 2 file $r2 not found for $sample"
  fi
done