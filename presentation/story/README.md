# Story page publishing

This page is a static site and can be deployed directly with GitHub Pages.

## Local preview

From the repository root:

```bash
python3 -m http.server 8000 --directory presentation/story
```

Then open:

```text
http://localhost:8000
```

## Public sharing

The workflow at `.github/workflows/deploy-story.yml` publishes `presentation/story` to GitHub Pages whenever changes under this folder are pushed to `main`.

After Pages is enabled for this repository, the site URL should be:

```text
https://leo-poon-lab.github.io/HPV_DOCK8_Phylodynamics/
```

If the repository owner or name changes, the URL changes accordingly.
