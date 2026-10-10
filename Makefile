# The app lives in worker/ (API, D1) and frontend/ (React). These pass through.
.PHONY: dev test seed-demo
dev:
	$(MAKE) -C worker dev
test:
	$(MAKE) -C worker test && npm --prefix frontend test && npm --prefix frontend run build
seed-demo:
	$(MAKE) -C worker seed-demo
