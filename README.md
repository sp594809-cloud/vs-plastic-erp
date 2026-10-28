# VS Curtain Accessories wholesale platform

The application lives in [`.gemini/antigravity/scratch/vs-plastic-erp`](.gemini/antigravity/scratch/vs-plastic-erp). See its [setup, deployment and verification guide](.gemini/antigravity/scratch/vs-plastic-erp/README.md).

This redesign keeps the existing TiDB database connection and adds separate `w_` wholesale tables. Existing manufacturing ERP records are preserved. Configure the new administrator and session secret before deployment. The old application is retained in Git history.
