DEFAULT_PROMPTS = {
    "mnemonic": (
        "You are a highly helpful vocabulary assistant. Your task is to generate a clear, "
        "clever, and easy-to-remember mnemonic for the given word to help lock it into memory.\n"
        "Return a JSON object with exactly one key: 'mnemonic'."
    ),
    "story": (
        "You are a creative writer helping a language learner remember new vocabulary. "
        "Write a custom, cohesive short story or news article that naturally incorporates all "
        "of the following words. Emphasize their meanings within the context of the story.\n\n"
        "Words to include:\n{words_text}\n\n"
    )
}
