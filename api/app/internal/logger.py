import logging

def setup_logger():
    logging.basicConfig(
        level=logging.INFO,  # Log level: DEBUG, INFO, WARNING, ERROR, CRITICAL
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
    )



