# Simbisa Multi-Currency Sales Reporting Application

## Overview

The Simbisa Multi-Currency Sales Reporting Application is a web-based management reporting platform that integrates with the GAAP Unity Data API to provide centralized product sales reporting across all Simbisa brands and stores. The application is designed for Simbisa Head Office and Regional Managers to analyse product performance across multiple currencies, particularly USD and ZWG, addressing the limitation of existing departmental sales reports that do not adequately separate sales by currency. Users can select departments, browse and select multiple products, define a reporting period, filter by brand or individual stores, and generate summary and detailed sales reports with quantities and turnover independently grouped by currency. Reports can also be exported to Excel for further analysis and distribution.

## Goals

1. Provide accurate multi-currency sales reporting by separating product quantities and turnover according to their actual transaction currencies, including USD, ZWG and other currencies supported by GAAP Unity.
2. Enable management to generate product sales reports across all Simbisa brands and stores using configurable date ranges, departments, products and store filters.
3. Provide two reporting views: consolidated sales summaries by store and currency, and detailed product-level sales by store and currency.
4. Reduce manual sales extraction and Excel consolidation by providing automated reporting directly from the GAAP Unity Data API.
5. Enable users to export generated reports into structured Excel workbooks containing summary, product details, currency summaries and transaction-level data.
6. Maintain reporting accuracy through transaction validation, complete API pagination, currency verification and reconciliation between summary and detailed reports.

## Core User Flow

1.