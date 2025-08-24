# Security-hardened infrastructure for banking application
terraform {
  required_version = ">= 1.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

#------------------------------------------------------------------------------
# Security Groups with Strict Rules
#------------------------------------------------------------------------------
resource "aws_security_group" "web_tier" {
  name_prefix = "${var.environment}-web-sg"
  vpc_id      = var.vpc_id

  # HTTPS only from ALB
  ingress {
    from_port       = 443
    to_port         = 443
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
    description     = "HTTPS from ALB only"
  }

  # NO HTTP allowed in production
  dynamic "ingress" {
    for_each = var.environment != "prod" ? [1] : []
    content {
      from_port       = 80
      to_port         = 80
      protocol        = "tcp"
      security_groups = [aws_security_group.alb.id]
      description     = "HTTP from ALB (non-prod only)"
    }
  }

  # Outbound HTTPS for API calls
  egress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "HTTPS outbound"
  }

  # Database access
  egress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.database.id]
    description     = "PostgreSQL to database tier"
  }

  tags = {
    Name        = "${var.environment}-web-sg"
    Environment = var.environment
    Tier        = "Web"
    Security    = "Hardened"
  }
}

resource "aws_security_group" "alb" {
  name_prefix = "${var.environment}-alb-sg"
  vpc_id      = var.vpc_id

  # HTTPS from internet
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = var.allowed_cidrs
    description = "HTTPS from internet"
  }

  # HTTP redirect to HTTPS
  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = var.allowed_cidrs
    description = "HTTP redirect to HTTPS"
  }

  egress {
    from_port       = 443
    to_port         = 443
    protocol        = "tcp"
    security_groups = [aws_security_group.web_tier.id]
    description     = "HTTPS to web tier"
  }

  tags = {
    Name        = "${var.environment}-alb-sg"
    Environment = var.environment
    Tier        = "LoadBalancer"
    Security    = "Hardened"
  }
}

resource "aws_security_group" "database" {
  name_prefix = "${var.environment}-db-sg"
  vpc_id      = var.vpc_id

  # PostgreSQL from web tier only
  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.web_tier.id]
    description     = "PostgreSQL from web tier only"
  }

  # NO outbound internet access for database
  # Database should be completely isolated

  tags = {
    Name        = "${var.environment}-db-sg"
    Environment = var.environment
    Tier        = "Database"
    Security    = "Isolated"
  }
}

#------------------------------------------------------------------------------
# WAF (Web Application Firewall) for Banking App
#------------------------------------------------------------------------------
resource "aws_wafv2_web_acl" "banking_waf" {
  name  = "${var.environment}-banking-waf"
  scope = "REGIONAL"

  default_action {
    allow {}
  }

  # Rate limiting rule
  rule {
    name     = "RateLimitRule"
    priority = 1

    override_action {
      none {}
    }

    statement {
      rate_based_statement {
        limit              = 2000
        aggregate_key_type = "IP"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "RateLimitRule"
      sampled_requests_enabled   = true
    }

    action {
      block {}
    }
  }

  # SQL Injection protection
  rule {
    name     = "SQLInjectionRule"
    priority = 2

    override_action {
      none {}
    }

    statement {
      sqli_match_statement {
        field_to_match {
          body {}
        }
        text_transformation {
          priority = 1
          type     = "URL_DECODE"
        }
        text_transformation {
          priority = 2
          type     = "HTML_ENTITY_DECODE"
        }
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "SQLInjectionRule"
      sampled_requests_enabled   = true
    }

    action {
      block {}
    }
  }

  # XSS protection
  rule {
    name     = "XSSRule"
    priority = 3

    override_action {
      none {}
    }

    statement {
      xss_match_statement {
        field_to_match {
          body {}
        }
        text_transformation {
          priority = 1
          type     = "URL_DECODE"
        }
        text_transformation {
          priority = 2
          type     = "HTML_ENTITY_DECODE"
        }
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "XSSRule"
      sampled_requests_enabled   = true
    }

    action {
      block {}
    }
  }

  # Geo-blocking (restrict to specific countries)
  rule {
    name     = "GeoBlockingRule"
    priority = 4

    statement {
      geo_match_statement {
        # Block high-risk countries (example)
        country_codes = ["CN", "RU", "KP", "IR"]
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "GeoBlockingRule"
      sampled_requests_enabled   = true
    }

    action {
      block {}
    }
  }

  # Known bad IP reputation
  rule {
    name     = "AWSManagedRulesKnownBadInputsRuleSet"
    priority = 5

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "KnownBadInputsRuleSet"
      sampled_requests_enabled   = true
    }
  }

  tags = {
    Name        = "${var.environment}-banking-waf"
    Environment = var.environment
    Security    = "WebApplicationFirewall"
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${var.environment}-banking-waf"
    sampled_requests_enabled   = true
  }
}

#------------------------------------------------------------------------------
# GuardDuty for Threat Detection
#------------------------------------------------------------------------------
resource "aws_guardduty_detector" "main" {
  enable                       = true
  finding_publishing_frequency = "FIFTEEN_MINUTES"

  datasources {
    s3_logs {
      enable = true
    }
    kubernetes {
      audit_logs {
        enable = true
      }
    }
  }

  tags = {
    Name        = "${var.environment}-guardduty"
    Environment = var.environment
    Security    = "ThreatDetection"
  }
}

#------------------------------------------------------------------------------
# Config for Compliance Monitoring
#------------------------------------------------------------------------------
resource "aws_config_configuration_recorder" "main" {
  name     = "${var.environment}-config-recorder"
  role_arn = aws_iam_role.config.arn

  recording_group {
    all_supported                 = true
    include_global_resource_types = true
  }
}

resource "aws_config_delivery_channel" "main" {
  name           = "${var.environment}-config-delivery-channel"
  s3_bucket_name = aws_s3_bucket.config.id
}

resource "aws_s3_bucket" "config" {
  bucket        = "${var.environment}-banking-config-${random_string.bucket_suffix.result}"
  force_destroy = var.environment != "prod"

  tags = {
    Name        = "${var.environment}-config-bucket"
    Environment = var.environment
    Security    = "Compliance"
  }
}

resource "aws_s3_bucket_versioning" "config" {
  bucket = aws_s3_bucket.config.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_encryption" "config" {
  bucket = aws_s3_bucket.config.id

  server_side_encryption_configuration {
    rule {
      apply_server_side_encryption_by_default {
        sse_algorithm     = "aws:kms"
        kms_master_key_id = aws_kms_key.config.arn
      }
    }
  }
}

resource "aws_kms_key" "config" {
  description             = "KMS key for Config bucket encryption"
  deletion_window_in_days = 7

  tags = {
    Name        = "${var.environment}-config-kms"
    Environment = var.environment
    Security    = "Encryption"
  }
}

resource "aws_iam_role" "config" {
  name = "${var.environment}-config-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "config.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "config" {
  role       = aws_iam_role.config.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWS_ConfigServiceRole"
}

#------------------------------------------------------------------------------
# CloudTrail for Audit Logging
#------------------------------------------------------------------------------
resource "aws_cloudtrail" "main" {
  name           = "${var.environment}-banking-trail"
  s3_bucket_name = aws_s3_bucket.cloudtrail.id

  enable_log_file_validation    = true
  include_global_service_events = true
  is_multi_region_trail         = true
  enable_logging                = true

  insight_selector {
    insight_type = "ApiCallRateInsight"
  }

  event_selector {
    read_write_type                 = "All"
    include_management_events       = true
    exclude_management_event_sources = []

    data_resource {
      type   = "AWS::S3::Object"
      values = ["${aws_s3_bucket.app_data.arn}/*"]
    }
  }

  tags = {
    Name        = "${var.environment}-cloudtrail"
    Environment = var.environment
    Security    = "AuditLogging"
  }
}

resource "aws_s3_bucket" "cloudtrail" {
  bucket        = "${var.environment}-banking-cloudtrail-${random_string.bucket_suffix.result}"
  force_destroy = var.environment != "prod"

  tags = {
    Name        = "${var.environment}-cloudtrail-bucket"
    Environment = var.environment
    Security    = "AuditLogs"
  }
}

resource "aws_s3_bucket" "app_data" {
  bucket        = "${var.environment}-banking-data-${random_string.bucket_suffix.result}"
  force_destroy = var.environment != "prod"

  tags = {
    Name        = "${var.environment}-app-data"
    Environment = var.environment
    Security    = "ApplicationData"
  }
}

resource "random_string" "bucket_suffix" {
  length  = 8
  special = false
  upper   = false
}

#------------------------------------------------------------------------------
# Secrets Manager for Database Credentials
#------------------------------------------------------------------------------
resource "aws_secretsmanager_secret" "db_credentials" {
  name        = "${var.environment}/banking/db-credentials"
  description = "Database credentials for banking application"

  replica {
    region = "us-east-1"  # Cross-region backup
  }

  tags = {
    Name        = "${var.environment}-db-secret"
    Environment = var.environment
    Security    = "SecretsManagement"
  }
}

resource "aws_secretsmanager_secret_version" "db_credentials" {
  secret_id = aws_secretsmanager_secret.db_credentials.id
  secret_string = jsonencode({
    username = var.db_username
    password = var.db_password
    engine   = "postgres"
    host     = var.db_host
    port     = 5432
    dbname   = var.db_name
  })
}

#------------------------------------------------------------------------------
# Security Outputs
#------------------------------------------------------------------------------
output "web_security_group_id" {
  value = aws_security_group.web_tier.id
}

output "database_security_group_id" {
  value = aws_security_group.database.id
}

output "waf_acl_arn" {
  value = aws_wafv2_web_acl.banking_waf.arn
}

output "guardduty_detector_id" {
  value = aws_guardduty_detector.main.id
}

output "cloudtrail_arn" {
  value = aws_cloudtrail.main.arn
}

#------------------------------------------------------------------------------
# Variables
#------------------------------------------------------------------------------
variable "environment" {
  description = "Environment name"
  type        = string
}

variable "vpc_id" {
  description = "VPC ID"
  type        = string
}

variable "allowed_cidrs" {
  description = "Allowed CIDR blocks"
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "db_username" {
  description = "Database username"
  type        = string
  default     = "bankadmin"
}

variable "db_password" {
  description = "Database password"
  type        = string
  sensitive   = true
}

variable "db_host" {
  description = "Database host"
  type        = string
}

variable "db_name" {
  description = "Database name"
  type        = string
  default     = "bankdb"
}