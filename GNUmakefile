SHELL = bash
PROJECT_ROOT := $(patsubst %/,%,$(dir $(abspath $(lastword $(MAKEFILE_LIST)))))

NODEJS_ROOT := $(PROJECT_ROOT)/nodejs

.PHONY: bootstrap
bootstrap:
	@$(MAKE) -C $(NODEJS_ROOT) $@

.PHONY: lint
lint:
	@$(MAKE) -C $(NODEJS_ROOT) $@

.PHONY: test
test:
	@$(MAKE) -C $(NODEJS_ROOT) $@

.PHONY: dist
dist:
	@$(MAKE) -C $(NODEJS_ROOT) $@

.PHONY: version
version:
	@$(MAKE) -C $(NODEJS_ROOT) $@
